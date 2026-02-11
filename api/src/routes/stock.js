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

const receiptLineSchema = z.object({
  itemId: z.string().min(1),
  quantity: z.coerce.number().min(1),
  unitCost: z.coerce.number().min(0),
  supplier: z.string().optional(),
  purchasedAt: z.string().optional(),
});

const singleReceiptSchema = receiptLineSchema.extend({
  invoiceKey: z.string().optional(),
});

const batchReceiptSchema = z.object({
  lines: z.array(receiptLineSchema).min(1),
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

function parseReceiptPayload(body) {
  if (body.lines !== undefined) {
    let parsedLines = body.lines;
    if (typeof parsedLines === "string") {
      try {
        parsedLines = JSON.parse(parsedLines);
      } catch (err) {
        const parseErr = new Error("Invalid lines payload");
        parseErr.status = 400;
        throw parseErr;
      }
    }

    const data = validate(batchReceiptSchema, {
      ...body,
      lines: parsedLines,
    });

    return {
      invoiceKey: data.invoiceKey,
      lines: data.lines.map((line) => ({
        ...line,
        supplier: line.supplier ?? data.supplier,
        purchasedAt: line.purchasedAt ?? data.purchasedAt,
      })),
    };
  }

  const single = validate(singleReceiptSchema, body);
  const { invoiceKey, ...line } = single;
  return { invoiceKey, lines: [line] };
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
    const { invoiceKey, lines } = parseReceiptPayload(req.body);

    const usingS3 = s3Enabled();
    if (usingS3 && !invoiceKey) {
      return res.status(400).json({ error: "Invoice key is required for S3 uploads" });
    }
    if (!usingS3 && !req.file) {
      return res.status(400).json({ error: "Invoice file is required" });
    }

    const uniqueItemIds = [...new Set(lines.map((line) => line.itemId))];
    for (const itemId of uniqueItemIds) {
      if (!mongoose.isValidObjectId(itemId)) {
        return res.status(400).json({ error: "Invalid item id" });
      }
    }

    const items = await Item.find({ _id: { $in: uniqueItemIds } }).select("_id").lean();
    if (items.length !== uniqueItemIds.length) {
      return res.status(404).json({ error: "Item not found" });
    }

    const now = new Date();
    const receipts = await StockReceipt.insertMany(
      lines.map((line) => ({
        item: line.itemId,
        quantity: line.quantity,
        remainingQuantity: line.quantity,
        unitCost: line.unitCost,
        invoiceFile: req.file?.filename,
        invoiceKey,
        invoiceStorage: usingS3 ? "s3" : "local",
        supplier: line.supplier,
        purchasedAt: line.purchasedAt ? new Date(line.purchasedAt) : now,
        createdBy: req.user._id,
      }))
    );

    res.json({ receipt: receipts[0], receipts });
  } catch (err) {
    next(err);
  }
});
