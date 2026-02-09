import express from "express";
import { z } from "zod";
import multer from "multer";
import { parse } from "csv-parse/sync";

import { Item } from "../models/Item.js";
import { StockReceipt } from "../models/StockReceipt.js";
import { validate } from "../lib/validate.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const itemRouter = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const categoryEnum = z.enum(["whiskey", "wine", "rum", "beer", "vodka", "cognac","gin", "other"]);

const itemSchema = z.object({
  name: z.string().min(2),
  sku: z.string().min(2),
  category: categoryEnum.optional(),
  size: z.string().optional(),
  abv: z.number().min(0).max(100).optional(),
  buyingPrice: z.number().min(0).optional(),
  sellingPrice: z.number().min(0).optional(),
  reorderLevel: z.number().min(0).optional(),
});

const statusSchema = z.object({
  status: z.enum(["active", "frozen"]),
});

itemRouter.use(requireAuth);

function encodeCursor(doc) {
  if (!doc) return null;
  return Buffer.from(JSON.stringify({ name: doc.name, _id: doc._id.toString() })).toString("base64");
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    return JSON.parse(Buffer.from(cursor, "base64").toString());
  } catch (err) {
    return null;
  }
}

// Cursor pagination for items by name (alphabetical)
itemRouter.get("/", async (req, res, next) => {
  try {
    const { limit = 50, cursor, direction = "next" } = req.query;
    const lim = Math.min(200, Number(limit) || 50);

    let sort = { name: 1, _id: 1 };
    let query = {};

    if (cursor) {
      const parsed = decodeCursor(cursor);
      if (parsed && parsed.name) {
        if (direction === "prev") {
          // fetch names before (lexicographically smaller) -> newer in reverse order
          query = {
            $or: [{ name: { $lt: parsed.name } }, { name: parsed.name, _id: { $lt: parsed._id } }],
          };
          sort = { name: -1, _id: -1 };
        } else {
          // fetch names after (greater than)
          query = {
            $or: [{ name: { $gt: parsed.name } }, { name: parsed.name, _id: { $gt: parsed._id } }],
          };
          sort = { name: 1, _id: 1 };
        }
      }
    }

    let docs = await Item.find(query).sort(sort).limit(lim + 1).lean();

    // if we fetched in reverse order for prev, reverse back to display ascending
    if (cursor && direction === "prev") docs = docs.reverse();

    const hasMore = docs.length === lim + 1;
    if (hasMore) docs.pop();

    // compute totals for displayed items only
    const itemIds = docs.map((d) => d._id);
    const totals = itemIds.length
      ? await StockReceipt.aggregate([
          { $match: { item: { $in: itemIds } } },
          { $group: { _id: "$item", availableQuantity: { $sum: "$remainingQuantity" } } },
        ])
      : [];

    const totalsMap = new Map(totals.map((t) => [t._id.toString(), t.availableQuantity]));

    const enriched = docs.map((item) => {
      const availableQuantity = totalsMap.get(item._id.toString()) || 0;
      const lowStock = item.reorderLevel > 0 && availableQuantity <= item.reorderLevel;
      return { ...item, availableQuantity, lowStock };
    });

    const nextCursor = enriched.length ? encodeCursor(enriched[enriched.length - 1]) : null;
    const prevCursor = enriched.length ? encodeCursor(enriched[0]) : null;

    res.json({ items: enriched, nextCursor, prevCursor, limit: lim, hasMore });
  } catch (err) {
    next(err);
  }
});

itemRouter.post("/", async (req, res, next) => {
  try {
    const data = validate(itemSchema, req.body);
    const item = await Item.create({ ...data, createdBy: req.user._id });
    res.json({ item });
  } catch (err) {
    next(err);
  }
});

itemRouter.post("/bulk", requireRole("admin"), upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "CSV file is required" });
    }

    const records = parse(req.file.buffer.toString("utf-8"), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: "CSV file is empty" });
    }

    let created = 0;
    let updated = 0;

    for (const row of records) {
      const data = validate(itemSchema, {
        name: row.name,
        sku: row.sku,
        category: row.category || undefined,
        size: row.size || undefined,
        abv: row.abv ? Number(row.abv) : undefined,
        buyingPrice: row.buyingPrice ? Number(row.buyingPrice) : undefined,
        sellingPrice: row.sellingPrice ? Number(row.sellingPrice) : undefined,
        reorderLevel: row.reorderLevel ? Number(row.reorderLevel) : undefined,
      });

      const existing = await Item.findOne({ sku: data.sku });
      if (existing) {
        await Item.updateOne({ _id: existing._id }, data);
        updated += 1;
      } else {
        await Item.create({ ...data, createdBy: req.user._id });
        created += 1;
      }
    }

    res.json({ created, updated });
  } catch (err) {
    next(err);
  }
});

itemRouter.patch("/:id", async (req, res, next) => {
  try {
    const data = validate(itemSchema.partial(), req.body);
    const item = await Item.findByIdAndUpdate(req.params.id, data, { new: true });
    if (!item) return res.status(404).json({ error: "Item not found" });
    res.json({ item });
  } catch (err) {
    next(err);
  }
});

itemRouter.patch("/:id/status", async (req, res, next) => {
  try {
    const data = validate(statusSchema, req.body);
    const item = await Item.findByIdAndUpdate(req.params.id, { status: data.status }, { new: true });
    if (!item) return res.status(404).json({ error: "Item not found" });
    res.json({ item });
  } catch (err) {
    next(err);
  }
});
