import express from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import crypto from "crypto";
import nodemailer from "nodemailer";

import { User } from "../models/User.js";
import { validate } from "../lib/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { logAudit } from "../middleware/audit.js";
import { authLimiter, forgotLimiter } from "../middleware/rateLimit.js";

export const authRouter = express.Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const forgotSchema = z.object({ email: z.string().email() });
const resetSchema = z.object({ token: z.string().min(1), newPassword: z.string().min(6) });
const changeSchema = z.object({ currentPassword: z.string().min(6), newPassword: z.string().min(6) });

function issueToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function setAuthCookie(res, token) {
  res.cookie("token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

async function sendResetEmail(to, token) {
  const frontend = process.env.FRONTEND_URL || "http://localhost:5173";
  const resetUrl = `${frontend}/reset-password?token=${token}`;

  if (process.env.SMTP_HOST) {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });

    await transporter.sendMail({
      from: process.env.SMTP_FROM || "no-reply@barreldrop.local",
      to,
      subject: "Password reset",
      text: `Reset your password: ${resetUrl}`,
      html: `<p>Reset your password: <a href="${resetUrl}">${resetUrl}</a></p>`,
    });
  } else {
    // No SMTP configured — log the URL so devs can use it.
    console.info("Password reset URL (no SMTP configured):", resetUrl);
  }
}

authRouter.post("/login", authLimiter, async (req, res, next) => {
  try {
    const { email, password } = validate(loginSchema, req.body);
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !user.active) {
      await logAudit(req, { action: "login.failed", meta: { email } });
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const ok = await user.verifyPassword(password);
    if (!ok) {
      await logAudit(req, { action: "login.failed", meta: { email } });
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = issueToken(user);
    setAuthCookie(res, token);

    await logAudit(req, { action: "login.success", targetType: "User", targetId: user._id });

    res.json({
      user: { id: user._id, name: user.name, email: user.email, role: user.role, forcePasswordChange: !!user.forcePasswordChange },
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      forcePasswordChange: !!req.user.forcePasswordChange,
    },
  });
});

// Forgot password — sends reset email (if SMTP configured) or logs link
authRouter.post("/forgot-password", forgotLimiter, async (req, res, next) => {
  try {
    const { email } = validate(forgotSchema, req.body);
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      await logAudit(req, { action: "forgot-password.request", meta: { email } });
      return res.json({ ok: true }); // don't reveal
    }

    const token = crypto.randomBytes(32).toString("hex");
    user.passwordResetToken = token;
    user.passwordResetExpires = new Date(Date.now() + 3600 * 1000); // 1 hour
    await user.save();

    await sendResetEmail(user.email, token);
    await logAudit(req, { action: "forgot-password.request", targetType: "User", targetId: user._id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Reset password using token
authRouter.post("/reset-password", forgotLimiter, async (req, res, next) => {
  try {
    const { token, newPassword } = validate(resetSchema, req.body);
    const user = await User.findOne({ passwordResetToken: token, passwordResetExpires: { $gt: new Date() } });
    if (!user) {
      await logAudit(req, { action: "reset-password.failed", meta: { token } });
      return res.status(400).json({ error: "Invalid or expired token" });
    }

    user.passwordHash = await User.hashPassword(newPassword);
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    user.forcePasswordChange = false;
    await user.save();

    await logAudit(req, { action: "reset-password.success", targetType: "User", targetId: user._id });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Authenticated change password
authRouter.post("/change-password", requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = validate(changeSchema, req.body);
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const ok = await user.verifyPassword(currentPassword);
    if (!ok) {
      await logAudit(req, { action: "change-password.failed", targetType: "User", targetId: user._id });
      return res.status(400).json({ error: "Current password is incorrect" });
    }

    user.passwordHash = await User.hashPassword(newPassword);
    user.forcePasswordChange = false;
    await user.save();

    await logAudit(req, { action: "change-password.success", targetType: "User", targetId: user._id });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
