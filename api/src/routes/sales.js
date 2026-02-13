import express from "express";
import mongoose from "mongoose";
import PDFDocument from "pdfkit";
import { z } from "zod";

import { Sale } from "../models/Sale.js";
import { Item } from "../models/Item.js";
import { StockReceipt } from "../models/StockReceipt.js";
import { buildDateRange } from "../lib/dateRange.js";
import { roundMoney, roundNumber } from "../lib/money.js";
import { applyStockDeductions, planReceiptConsumption, rollbackStockDeductions } from "../lib/stock.js";
import { validate } from "../lib/validate.js";
import { requireAuth } from "../middleware/auth.js";

export const salesRouter = express.Router();

const saleSchema = z.object({
  items: z
    .array(
      z.object({
        itemId: z.string().min(1),
        quantity: z.coerce.number().positive().finite(),
      })
    )
    .min(1),
  notes: z.string().optional(),
});

salesRouter.use(requireAuth);

function encodeCursor(doc, dateField = "soldAt") {
  if (!doc) return null;
  return Buffer.from(JSON.stringify({ date: doc[dateField].toISOString(), _id: doc._id.toString() })).toString("base64");
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    return JSON.parse(Buffer.from(cursor, "base64").toString());
  } catch (err) {
    return null;
  }
}

salesRouter.get("/", async (req, res, next) => {
  try {
    const { start, end, limit = 20, cursor, direction = "next", tzOffsetMinutes } = req.query;
    const lim = Math.min(200, Number(limit) || 20);

    // Build base query: respect role and optional date range
    const base = req.user.role === "admin" ? {} : { createdBy: req.user._id };
    const dateFilter = buildDateRange({ start, end, tzOffsetMinutes });

    let sort = { soldAt: -1, _id: -1 };
    let query = { ...base };
    if (dateFilter) query.soldAt = dateFilter;

    if (cursor) {
      const parsed = decodeCursor(cursor);
      if (parsed && parsed.date) {
        const cDate = new Date(parsed.date);
        if (direction === "prev") {
          query = {
            ...query,
            $or: [{ soldAt: { $gt: cDate } }, { soldAt: cDate, _id: { $gt: parsed._id } }],
          };
          sort = { soldAt: 1, _id: 1 };
        } else {
          query = {
            ...query,
            $or: [{ soldAt: { $lt: cDate } }, { soldAt: cDate, _id: { $lt: parsed._id } }],
          };
          sort = { soldAt: -1, _id: -1 };
        }
      }
    }

    let docs = await Sale.find(query)
      .sort(sort)
      .limit(lim + 1)
      .populate("items.item", "name sku")
      .populate("createdBy", "name email");

    if (cursor && direction === "prev") docs = docs.reverse();

    const hasMore = docs.length === lim + 1;
    if (hasMore) docs.pop();

    const nextCursor = docs.length ? encodeCursor(docs[docs.length - 1]) : null;
    const prevCursor = docs.length ? encodeCursor(docs[0]) : null;

    res.json({ sales: docs, nextCursor, prevCursor, limit: lim, hasMore });
  } catch (err) {
    next(err);
  }
});

salesRouter.post("/", async (req, res, next) => {
  let appliedDeductions = [];
  try {
    const payload = validate(saleSchema, req.body);

    const saleItems = [];
    let totalRevenue = 0;
    let totalCost = 0;
    const stagedReceiptRemaining = new Map();
    const plannedDeductions = new Map();

    for (const line of payload.items) {
      if (!mongoose.isValidObjectId(line.itemId)) {
        const err = new Error("Invalid item id");
        err.status = 400;
        throw err;
      }

      const item = await Item.findById(line.itemId);
      if (!item) {
        const err = new Error("Item not found");
        err.status = 404;
        throw err;
      }
      if (item.status === "frozen") {
        const err = new Error(`Item ${item.name} is frozen`);
        err.status = 400;
        throw err;
      }

      const receipts = await StockReceipt.find({
        item: item._id,
        remainingQuantity: { $gt: 0 },
      }).sort({ purchasedAt: 1, createdAt: 1 });

      let remaining = line.quantity;
      let lineCost = 0;

      const planned = planReceiptConsumption({
        receipts,
        requestedQuantity: line.quantity,
        stagedRemainingByReceiptId: stagedReceiptRemaining,
        plannedDeductionsByReceiptId: plannedDeductions,
      });
      remaining = planned.remaining;
      lineCost = roundMoney(planned.lineCost);

      if (remaining > 1e-9) {
        const err = new Error(`Not enough stock for ${item.name}`);
        err.status = 400;
        throw err;
      }

      const unitPrice = roundMoney(item.sellingPrice ?? 0);
      const lineTotal = roundMoney(line.quantity * unitPrice);
      totalRevenue = roundMoney(totalRevenue + lineTotal);
      totalCost = roundMoney(totalCost + lineCost);

      saleItems.push({
        item: item._id,
        quantity: line.quantity,
        unitPrice,
        unitCost: roundNumber(lineCost / line.quantity, 4),
        lineTotal,
        lineCost,
      });
    }

    if (plannedDeductions.size > 0) {
      appliedDeductions = await applyStockDeductions({
        stockReceiptModel: StockReceipt,
        plannedDeductionsByReceiptId: plannedDeductions,
      });
    }

    const sale = await Sale.create([
      {
        items: saleItems,
        totalRevenue,
        totalCost,
        profit: roundMoney(totalRevenue - totalCost),
        soldAt: new Date(),
        createdBy: req.user._id,
        notes: payload.notes,
      },
    ]);

    appliedDeductions = [];
    res.json({ sale: sale[0] });
  } catch (err) {
    try {
      await rollbackStockDeductions({
        stockReceiptModel: StockReceipt,
        appliedDeductions,
      });
    } catch (rollbackErr) {
      console.error("Failed to rollback stock deductions for sale:", rollbackErr);
    }
    next(err);
  }
});

// Generate a PDF receipt for a sale. Downloads as a .pdf file.
salesRouter.get('/:id/receipt', async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!mongoose.isValidObjectId(id)) {
      const err = new Error('Invalid sale id');
      err.status = 400;
      throw err;
    }

    const sale = await Sale.findById(id).populate('items.item', 'name sku').populate('createdBy', 'email name');
    if (!sale) {
      const err = new Error('Sale not found');
      err.status = 404;
      throw err;
    }

    // Only admins or the creator can download the receipt
    if (req.user.role !== 'admin' && (!sale.createdBy || sale.createdBy._id.toString() !== req.user._id.toString())) {
      const err = new Error('Not authorized to access this receipt');
      err.status = 403;
      throw err;
    }

    const currency = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    });

    function fmt(n) {
      return currency.format(Number(n));
    }

    const doc = new PDFDocument({ size: "LETTER", margin: 48 });
    const filename = `sale-${sale._id}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    doc.pipe(res);

    doc.fontSize(18).font("Helvetica-Bold").text("Barrel Drop Receipt");
    doc.moveDown(0.5);

    doc.fontSize(10).fillColor("#333333");
    doc.text(`Sale ID: ${sale._id}`);
    doc.text(`Sold At: ${new Date(sale.soldAt).toLocaleString("en-US")}`);
    if (sale.createdBy) {
      doc.text(`Created By: ${sale.createdBy.name || sale.createdBy._id}`);
    }
    if (sale.notes) {
      doc.text(`Notes: ${sale.notes}`);
    }

    doc.moveDown(1);
    doc.moveDown(0.3);

    const col = {
      name: doc.page.margins.left,
      qty: 340,
      unit: 400,
      total: 470,
    };
    const widths = {
      name: col.qty - col.name - 8,
      qty: 40,
      unit: 70,
      total: 80,
    };

    const rowHeight = 16;
    const bottomY = doc.page.height - doc.page.margins.bottom;

    function ensureSpace(height) {
      if (doc.y + height > bottomY) {
        doc.addPage();
      }
    }

    doc.fontSize(10).font("Helvetica-Bold");
    const headerY = doc.y;
    doc.text("Name", col.name, headerY, { width: widths.name, align: "left" });
    doc.text("Qty", col.qty, headerY, { width: widths.qty, align: "right" });
    doc.text("Unit Price", col.unit, headerY, { width: widths.unit, align: "right" });
    doc.text("Line Total", col.total, headerY, { width: widths.total, align: "right" });
    doc.y = headerY + rowHeight;
    doc.moveTo(col.name, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke("#cccccc");
    doc.moveDown(0.4);

    doc.font("Helvetica").fillColor("#111111");
    for (const line of sale.items) {
      ensureSpace(rowHeight);
      const name = (line.item && line.item.name) ? line.item.name : (line.item || "");
      const y = doc.y;
      doc.text(name, col.name, y, { width: widths.name, align: "left" });
      doc.text(String(line.quantity), col.qty, y, { width: widths.qty, align: "right" });
      doc.text(fmt(line.unitPrice), col.unit, y, { width: widths.unit, align: "right" });
      doc.text(fmt(line.lineTotal), col.total, y, { width: widths.total, align: "right" });
      doc.moveDown(0.9);
    }

    doc.moveDown(0.5);
    doc.moveTo(col.name, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke("#cccccc");
    doc.moveDown(0.6);

    doc.font("Helvetica-Bold");
    const totalY = doc.y;
    doc.text("Total Paid", col.unit, totalY, { width: widths.unit, align: "right" });
    doc.text(fmt(sale.totalRevenue), col.total, totalY, { width: widths.total, align: "right" });
    doc.y = totalY + rowHeight;

    doc.end();
  } catch (err) {
    next(err);
  }
});
