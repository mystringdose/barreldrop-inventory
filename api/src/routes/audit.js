import express from "express";
import { AuditLog } from "../models/AuditLog.js";
import { User } from "../models/User.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const auditRouter = express.Router();

// Admin-only: list audit logs with optional filters
auditRouter.use(requireAuth, requireRole("admin"));

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

// Cursor-based pagination: supports `limit`, `cursor` (base64 JSON), and `direction` ("next" or "prev").
// Default behavior: most recent first (createdAt desc). Passing `cursor` with `direction=next` fetches older items (createdAt < cursor).
// Passing `direction=prev` fetches newer items (createdAt > cursor).
auditRouter.get("/", async (req, res, next) => {
  try {
    const { limit = 20, cursor, action, actor, direction = "next" } = req.query;
    const lim = Math.min(200, Number(limit) || 20);

    const baseQuery = {};
    if (action) baseQuery.action = action;
    if (actor) {
      // support providing actor as email (easier UX) or as a user id
      if (actor.includes("@")) {
        const u = await User.findOne({ email: actor.toLowerCase() });
        if (!u) return res.json({ logs: [], nextCursor: null, prevCursor: null, limit: lim, hasMore: false });
        baseQuery.actor = u._id;
      } else {
        // ensure actor provided is a valid ObjectId string, otherwise return empty
        if (/^[0-9a-fA-F]{24}$/.test(actor)) {
          baseQuery.actor = actor;
        } else {
          return res.json({ logs: [], nextCursor: null, prevCursor: null, limit: lim, hasMore: false });
        }
      }
    }

    // optional date range filters: start, end (ISO or YYYY-MM-DD). End is inclusive.
    if (req.query.start || req.query.end) {
      const createdAt = {};
      if (req.query.start) {
        const s = new Date(req.query.start);
        if (!isNaN(s)) createdAt.$gte = s;
      }
      if (req.query.end) {
        let e = new Date(req.query.end);
        if (!isNaN(e)) {
          // if provided as date-only (YYYY-MM-DD) its time will be 00:00:00 - make it end of day
          if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.end)) {
            e.setHours(23, 59, 59, 999);
          }
          createdAt.$lte = e;
        }
      }
      if (Object.keys(createdAt).length) baseQuery.createdAt = createdAt;
    }

    let sort = { createdAt: -1, _id: -1 };
    let query = baseQuery;

    if (cursor) {
      const parsed = decodeCursor(cursor);
      if (parsed && parsed.createdAt) {
        const cDate = new Date(parsed.createdAt);
        if (direction === "prev") {
          // fetch newer items
          query = {
            ...baseQuery,
            $or: [{ createdAt: { $gt: cDate } }, { createdAt: cDate, _id: { $gt: parsed._id } }],
          };
          sort = { createdAt: 1, _id: 1 };
        } else {
          // fetch older items
          query = {
            ...baseQuery,
            $or: [{ createdAt: { $lt: cDate } }, { createdAt: cDate, _id: { $lt: parsed._id } }],
          };
          sort = { createdAt: -1, _id: -1 };
        }
      }
    }

    let docs = await AuditLog.find(query).sort(sort).limit(lim + 1).populate("actor", "name email role");

    // If we fetched in ascending order for prev, reverse back to descending for display
    if (cursor && direction === "prev") docs = docs.reverse();

    const hasMore = docs.length === lim + 1;
    if (hasMore) docs.pop(); // remove extra

    const nextCursor = docs.length ? encodeCursor(docs[docs.length - 1]) : null;
    const prevCursor = docs.length ? encodeCursor(docs[0]) : null;

    res.json({ logs: docs, nextCursor, prevCursor, limit: lim, hasMore });
  } catch (err) {
    next(err);
  }
});
