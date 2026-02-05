import express from "express";
import { z } from "zod";

import { User } from "../models/User.js";
import { validate } from "../lib/validate.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { logAudit } from "../middleware/audit.js";
import { defaultLimiter } from "../middleware/rateLimit.js";

export const userRouter = express.Router();

const createUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(["admin", "user"]).default("user"),
});

const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  password: z.string().min(6).optional(),
  role: z.enum(["admin", "user"]).optional(),
  active: z.boolean().optional(),
});

userRouter.post("/bootstrap", async (req, res, next) => {
  try {
    const count = await User.countDocuments();
    if (count > 0) return res.status(400).json({ error: "Users already exist" });

    const data = validate(createUserSchema, req.body);
    const passwordHash = await User.hashPassword(data.password);
    const user = await User.create({
      name: data.name,
      email: data.email.toLowerCase(),
      passwordHash,
      role: "admin",
      forcePasswordChange: true,
    });

    await logAudit(req, { action: "user.bootstrap", targetType: "User", targetId: user._id, meta: { email: user.email } });

    res.json({
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    next(err);
  }
});

userRouter.use(requireAuth, requireRole("admin"));

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

userRouter.get("/", async (req, res, next) => {
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

    let docs = await User.find(query).select("name email role active createdAt").sort(sort).limit(lim + 1);

    if (cursor && direction === "prev") docs = docs.reverse();

    const hasMore = docs.length === lim + 1;
    if (hasMore) docs.pop();

    const nextCursor = docs.length ? encodeCursor(docs[docs.length - 1]) : null;
    const prevCursor = docs.length ? encodeCursor(docs[0]) : null;

    res.json({ users: docs, nextCursor, prevCursor, limit: lim, hasMore });
  } catch (err) {
    next(err);
  }
});

userRouter.post("/", defaultLimiter, async (req, res, next) => {
  try {
    const data = validate(createUserSchema, req.body);
    const passwordHash = await User.hashPassword(data.password);

      const user = await User.create({
      name: data.name,
      email: data.email.toLowerCase(),
      passwordHash,
      role: data.role,
    });

    await logAudit(req, { action: "user.create", targetType: "User", targetId: user._id, meta: { role: user.role, email: user.email } });

    res.json({
      user: { id: user._id, name: user.name, email: user.email, role: user.role, active: user.active },
    });
  } catch (err) {
    next(err);
  }
});

userRouter.patch("/:id", defaultLimiter, async (req, res, next) => {
  try {
    const data = validate(updateUserSchema, req.body);
    const updates = { ...data };

    if (data.password) {
      updates.passwordHash = await User.hashPassword(data.password);
      delete updates.password;
    }

    const user = await User.findByIdAndUpdate(req.params.id, updates, { new: true })
      .select("name email role active");

    if (!user) return res.status(404).json({ error: "User not found" });

    await logAudit(req, { action: "user.update", targetType: "User", targetId: user._id, meta: updates });

    res.json({ user });
  } catch (err) {
    next(err);
  }
});

userRouter.delete("/:id", defaultLimiter, async (req, res, next) => {
  try {
    // Prevent deleting yourself
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ error: "You cannot delete your own account" });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Prevent removing the last admin
    if (user.role === "admin") {
      const adminCount = await User.countDocuments({ role: "admin" });
      if (adminCount <= 1) {
        return res.status(400).json({ error: "Cannot delete the last admin" });
      }
    }

    await User.deleteOne({ _id: user._id });
    await logAudit(req, { action: "user.delete", targetType: "User", targetId: user._id, meta: { email: user.email } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

