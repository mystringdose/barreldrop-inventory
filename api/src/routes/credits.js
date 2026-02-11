import express from "express";
import mongoose from "mongoose";
import { z } from "zod";

import { Credit } from "../models/Credit.js";
import { Item } from "../models/Item.js";
import { Sale } from "../models/Sale.js";
import { StockReceipt } from "../models/StockReceipt.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../lib/validate.js";

export const creditRouter = express.Router();

creditRouter.use(requireAuth);

const createCreditSchema = z.object({
  customerName: z.string().min(2),
  customerContact: z.string().optional(),
  notes: z.string().optional(),
  items: z
    .array(
      z.object({
        itemId: z.string().min(1),
        quantity: z.number().min(1),
      })
    )
    .min(1),
});

function encodeCursor(doc) {
  if (!doc) return null;
  return Buffer.from(JSON.stringify({ creditedAt: doc.creditedAt.toISOString(), _id: doc._id.toString() })).toString("base64");
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    return JSON.parse(Buffer.from(cursor, "base64").toString());
  } catch (err) {
    return null;
  }
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function andQuery(base, extra) {
  if (!base || Object.keys(base).length === 0) return extra || {};
  if (!extra || Object.keys(extra).length === 0) return base;
  return { $and: [base, extra] };
}

creditRouter.get("/", async (req, res, next) => {
  try {
    const { limit = 20, cursor, direction = "next", start, end, status = "all", q = "" } = req.query;
    const lim = Math.min(200, Number(limit) || 20);

    let baseQuery = req.user.role === "admin" ? {} : { createdBy: req.user._id };

    if (status === "open" || status === "converted") {
      baseQuery.status = status;
    }

    if (start || end) {
      const creditedAt = {};
      if (start) {
        const s = new Date(start);
        if (!isNaN(s)) creditedAt.$gte = s;
      }
      if (end) {
        let e = new Date(end);
        if (!isNaN(e)) {
          if (/^\d{4}-\d{2}-\d{2}$/.test(end)) e.setUTCHours(23, 59, 59, 999);
          creditedAt.$lte = e;
        }
      }
      if (Object.keys(creditedAt).length) baseQuery.creditedAt = creditedAt;
    }

    const search = String(q || "").trim();
    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      baseQuery = andQuery(baseQuery, {
        $or: [{ customerName: regex }, { customerContact: regex }],
      });
    }

    let sort = { creditedAt: -1, _id: -1 };
    let query = baseQuery;

    if (cursor) {
      const parsed = decodeCursor(cursor);
      if (parsed && parsed.creditedAt) {
        const cDate = new Date(parsed.creditedAt);
        let cursorQuery = {};
        if (direction === "prev") {
          cursorQuery = {
            $or: [{ creditedAt: { $gt: cDate } }, { creditedAt: cDate, _id: { $gt: parsed._id } }],
          };
          sort = { creditedAt: 1, _id: 1 };
        } else {
          cursorQuery = {
            $or: [{ creditedAt: { $lt: cDate } }, { creditedAt: cDate, _id: { $lt: parsed._id } }],
          };
          sort = { creditedAt: -1, _id: -1 };
        }
        query = andQuery(baseQuery, cursorQuery);
      }
    }

    let docs = await Credit.find(query)
      .sort(sort)
      .limit(lim + 1)
      .populate("items.item", "name sku")
      .populate("createdBy", "name email")
      .populate("convertedBy", "name email")
      .populate("convertedSale", "_id soldAt");

    if (cursor && direction === "prev") docs = docs.reverse();

    const hasMore = docs.length === lim + 1;
    if (hasMore) docs.pop();

    const nextCursor = docs.length ? encodeCursor(docs[docs.length - 1]) : null;
    const prevCursor = docs.length ? encodeCursor(docs[0]) : null;

    res.json({ credits: docs, nextCursor, prevCursor, limit: lim, hasMore });
  } catch (err) {
    next(err);
  }
});

creditRouter.post("/", async (req, res, next) => {
  try {
    const payload = validate(createCreditSchema, {
      ...req.body,
      items: req.body.items?.map((item) => ({
        ...item,
        quantity: Number(item.quantity),
      })),
    });

    const creditItems = [];
    let totalAmount = 0;
    let totalCost = 0;
    const stagedReceiptRemaining = new Map();
    const touchedReceipts = new Map();

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

      for (const receipt of receipts) {
        if (remaining <= 0) break;
        const receiptId = receipt._id.toString();
        const available = stagedReceiptRemaining.has(receiptId)
          ? stagedReceiptRemaining.get(receiptId)
          : receipt.remainingQuantity;
        if (available <= 0) continue;

        const useQty = Math.min(available, remaining);
        stagedReceiptRemaining.set(receiptId, available - useQty);
        touchedReceipts.set(receiptId, receipt);
        remaining -= useQty;
        lineCost += useQty * receipt.unitCost;
      }

      if (remaining > 0) {
        const err = new Error(`Not enough stock for ${item.name}`);
        err.status = 400;
        throw err;
      }

      const unitPrice = Number(item.sellingPrice ?? 0);
      const lineTotal = line.quantity * unitPrice;
      totalAmount += lineTotal;
      totalCost += lineCost;

      creditItems.push({
        item: item._id,
        quantity: line.quantity,
        unitPrice,
        unitCost: lineCost / line.quantity,
        lineTotal,
        lineCost,
      });
    }

    if (touchedReceipts.size > 0) {
      const ops = [];
      for (const [receiptId, receipt] of touchedReceipts.entries()) {
        ops.push({
          updateOne: {
            filter: { _id: receipt._id },
            update: { $set: { remainingQuantity: stagedReceiptRemaining.get(receiptId) } },
          },
        });
      }
      await StockReceipt.bulkWrite(ops);
    }

    const created = await Credit.create([
      {
        customerName: payload.customerName.trim(),
        customerContact: payload.customerContact?.trim() || undefined,
        notes: payload.notes,
        items: creditItems,
        totalAmount,
        totalCost,
        status: "open",
        creditedAt: new Date(),
        createdBy: req.user._id,
      },
    ]);

    res.json({ credit: created[0] });
  } catch (err) {
    next(err);
  }
});

creditRouter.post("/:id/convert", async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid credit id" });
    }

    const credit = await Credit.findById(id);
    if (!credit) return res.status(404).json({ error: "Credit not found" });
    if (req.user.role !== "admin" && credit.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (credit.status !== "open") return res.status(400).json({ error: "Credit already converted" });

    const saleItems = credit.items.map((line) => ({
      item: line.item,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      unitCost: line.unitCost,
      lineTotal: line.lineTotal,
      lineCost: line.lineCost,
    }));

    const notes = credit.notes
      ? `Converted from credit ${credit._id}: ${credit.notes}`
      : `Converted from credit ${credit._id}`;

    const created = await Sale.create([
      {
        items: saleItems,
        totalRevenue: credit.totalAmount,
        totalCost: credit.totalCost,
        profit: credit.totalAmount - credit.totalCost,
        soldAt: new Date(),
        createdBy: req.user._id,
        notes,
      },
    ]);

    credit.status = "converted";
    credit.convertedAt = new Date();
    credit.convertedSale = created[0]._id;
    credit.convertedBy = req.user._id;
    await credit.save();

    res.json({ creditId: credit._id, saleId: created[0]._id });
  } catch (err) {
    next(err);
  }
});
