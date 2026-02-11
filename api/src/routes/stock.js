import express from "express";
import multer from "multer";
import { z } from "zod";
import mongoose from "mongoose";

import { StockReceipt } from "../models/StockReceipt.js";
import { Item } from "../models/Item.js";
import { validate } from "../lib/validate.js";
import { createDownloadUrl, createUploadUrl, s3Enabled } from "../lib/s3.js";
import { requireAuth } from "../middleware/auth.js";

export const stockRouter = express.Router();

const upload = multer({ dest: "./uploads" });

const receiptSchema = z.object({
  itemId: z.string().min(1),
  quantity: z.number().min(1),
  unitCost: z.number().min(0),
  supplier: z.string().optional(),
  purchasedAt: z.string().optional(),
  invoiceKey: z.string().optional(),
});

stockRouter.use(requireAuth);

function encodeCursor(doc) {
  if (!doc) return null;
  return Buffer.from(JSON.stringify({ createdAt: doc.createdAt.toISOString(), _id: doc._id.toString() })).toString("base64");
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    return JSON.parse(Buffer.from(cursor, "base64").toString());
  } catch (err) {
    return null;
  }
}

stockRouter.get("/", async (req, res, next) => {
  try {
    const { limit = 20, cursor, direction = "next" } = req.query;
    const lim = Math.min(200, Number(limit) || 20);

    let sort = { createdAt: -1, _id: -1 };
    let query = {};

    if (cursor) {
      const parsed = decodeCursor(cursor);
      if (parsed && parsed.createdAt) {
        const cDate = new Date(parsed.createdAt);
        if (direction === "prev") {
          query = {
            $or: [{ createdAt: { $gt: cDate } }, { createdAt: cDate, _id: { $gt: parsed._id } }],
          };
          sort = { createdAt: 1, _id: 1 };
        } else {
          query = {
            $or: [{ createdAt: { $lt: cDate } }, { createdAt: cDate, _id: { $lt: parsed._id } }],
          };
          sort = { createdAt: -1, _id: -1 };
        }
      }
    }

    let docs = await StockReceipt.find(query).sort(sort).limit(lim + 1).populate("item", "name sku").lean();

    if (cursor && direction === "prev") docs = docs.reverse();

    const hasMore = docs.length === lim + 1;
    if (hasMore) docs.pop();

    // If s3 enabled, attach invoiceUrl for s3 receipts
    if (s3Enabled()) {
      const enriched = await Promise.all(
        docs.map(async (receipt) => {
          if (receipt.invoiceStorage === "s3" && receipt.invoiceKey) {
            const invoiceUrl = await createDownloadUrl({ key: receipt.invoiceKey });
            return { ...receipt, invoiceUrl };
          }
          return receipt;
        })
      );
      const nextCursor = enriched.length ? encodeCursor(enriched[enriched.length - 1]) : null;
      const prevCursor = enriched.length ? encodeCursor(enriched[0]) : null;
      return res.json({ receipts: enriched, nextCursor, prevCursor, limit: lim, hasMore });
    }

    const nextCursor = docs.length ? encodeCursor(docs[docs.length - 1]) : null;
    const prevCursor = docs.length ? encodeCursor(docs[0]) : null;

    res.json({ receipts: docs, nextCursor, prevCursor, limit: lim, hasMore });
  } catch (err) {
    next(err);
  }
});

stockRouter.post("/presign", async (req, res, next) => {
  try {
    if (!s3Enabled()) {
      return res.status(400).json({ error: "S3 is not configured" });
    }

    const schema = z.object({
      filename: z.string().min(1),
      contentType: z.string().min(1),
    });
    const { filename, contentType } = validate(schema, req.body);

    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const key = `invoices/${Date.now()}_${safeName}`;
    const upload = await createUploadUrl({ key, contentType });

    res.json({ upload });
  } catch (err) {
    next(err);
  }
});

stockRouter.post("/", upload.single("invoice"), async (req, res, next) => {
  try {
    const data = validate(receiptSchema, {
      ...req.body,
      quantity: Number(req.body.quantity),
      unitCost: Number(req.body.unitCost),
    });

    const usingS3 = s3Enabled();
    if (usingS3 && !data.invoiceKey) {
      return res.status(400).json({ error: "Invoice key is required for S3 uploads" });
    }
    if (!usingS3 && !req.file) {
      return res.status(400).json({ error: "Invoice file is required" });
    }

    if (!mongoose.isValidObjectId(data.itemId)) {
      return res.status(400).json({ error: "Invalid item id" });
    }

    const item = await Item.findById(data.itemId);
    if (!item) return res.status(404).json({ error: "Item not found" });

    const receipt = await StockReceipt.create({
      item: data.itemId,
      quantity: data.quantity,
      remainingQuantity: data.quantity,
      unitCost: data.unitCost,
      invoiceFile: req.file?.filename,
      invoiceKey: data.invoiceKey,
      invoiceStorage: usingS3 ? "s3" : "local",
      supplier: data.supplier,
      purchasedAt: data.purchasedAt ? new Date(data.purchasedAt) : new Date(),
      createdBy: req.user._id,
    });

    res.json({ receipt });
  } catch (err) {
    next(err);
  }
});
