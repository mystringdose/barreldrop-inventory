import express from "express";
import mongoose from "mongoose";
import { z } from "zod";

import { Credit } from "../models/Credit.js";
import { Item } from "../models/Item.js";
import { Sale } from "../models/Sale.js";
import { StockReceipt } from "../models/StockReceipt.js";
import { buildDateRange } from "../lib/dateRange.js";
import { roundMoney, roundNumber } from "../lib/money.js";
import { applyStockDeductions, planReceiptConsumption, rollbackStockDeductions } from "../lib/stock.js";
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
        quantity: z.coerce.number().positive().finite(),
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
    const { limit = 20, cursor, direction = "next", start, end, status = "all", q = "", tzOffsetMinutes } = req.query;
    const lim = Math.min(200, Number(limit) || 20);

    let baseQuery = req.user.role === "admin" ? {} : { createdBy: req.user._id };

    if (status === "open" || status === "converted") {
      baseQuery.status = status;
    }

    const creditedAt = buildDateRange({ start, end, tzOffsetMinutes });
    if (creditedAt) baseQuery.creditedAt = creditedAt;

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
  let appliedDeductions = [];
  try {
    const payload = validate(createCreditSchema, req.body);

    const creditItems = [];
    let totalAmount = 0;
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
      totalAmount = roundMoney(totalAmount + lineTotal);
      totalCost = roundMoney(totalCost + lineCost);

      creditItems.push({
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

    appliedDeductions = [];
    res.json({ credit: created[0] });
  } catch (err) {
    try {
      await rollbackStockDeductions({
        stockReceiptModel: StockReceipt,
        appliedDeductions,
      });
    } catch (rollbackErr) {
      console.error("Failed to rollback stock deductions for credit:", rollbackErr);
    }
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

    const lockedCredit = await Credit.findOneAndUpdate(
      {
        _id: credit._id,
        status: "open",
        conversionInProgress: { $ne: true },
      },
      {
        $set: { conversionInProgress: true },
      },
      { new: true }
    );

    if (!lockedCredit) {
      const latest = await Credit.findById(id).select("status conversionInProgress");
      if (!latest) return res.status(404).json({ error: "Credit not found" });
      if (latest.status !== "open") return res.status(400).json({ error: "Credit already converted" });
      return res.status(409).json({ error: "Credit conversion already in progress" });
    }

    const saleItems = lockedCredit.items.map((line) => ({
      item: line.item,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      unitCost: line.unitCost,
      lineTotal: line.lineTotal,
      lineCost: line.lineCost,
    }));

    const notes = lockedCredit.notes
      ? `Converted from credit ${lockedCredit._id}: ${lockedCredit.notes}`
      : `Converted from credit ${lockedCredit._id}`;

    let createdSale = null;
    let conversionFinalized = false;

    try {
      const created = await Sale.create([
        {
          items: saleItems,
          totalRevenue: roundMoney(lockedCredit.totalAmount),
          totalCost: roundMoney(lockedCredit.totalCost),
          profit: roundMoney(lockedCredit.totalAmount - lockedCredit.totalCost),
          soldAt: new Date(),
          createdBy: lockedCredit.createdBy,
          notes,
        },
      ]);
      createdSale = created[0];

      const converted = await Credit.findOneAndUpdate(
        {
          _id: lockedCredit._id,
          status: "open",
          conversionInProgress: true,
        },
        {
          $set: {
            status: "converted",
            convertedAt: new Date(),
            convertedSale: createdSale._id,
            convertedBy: req.user._id,
            conversionInProgress: false,
          },
        },
        { new: true }
      );

      if (!converted) {
        const conflictErr = new Error("Credit conversion state changed. Please retry.");
        conflictErr.status = 409;
        throw conflictErr;
      }

      conversionFinalized = true;
      res.json({ creditId: converted._id, saleId: createdSale._id });
    } catch (err) {
      if (!conversionFinalized && createdSale?._id) {
        try {
          await Sale.deleteOne({ _id: createdSale._id });
        } catch (cleanupErr) {
          console.error("Failed to clean up sale after credit conversion error:", cleanupErr);
        }
      }

      if (!conversionFinalized) {
        try {
          await Credit.updateOne(
            { _id: lockedCredit._id, status: "open", conversionInProgress: true },
            { $set: { conversionInProgress: false } }
          );
        } catch (unlockErr) {
          console.error("Failed to release credit conversion lock:", unlockErr);
        }
      }

      throw err;
    }
  } catch (err) {
    next(err);
  }
});
