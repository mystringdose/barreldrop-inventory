import rateLimit from "express-rate-limit";

const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000; // 15 minutes
const authMax = Number(process.env.AUTH_RATE_LIMIT_MAX) || 10; // e.g., 10 login attempts per window
const forgotMax = Number(process.env.FORGOT_RATE_LIMIT_MAX) || 5;
const defaultMax = Number(process.env.DEFAULT_RATE_LIMIT_MAX) || 100;

export const authLimiter = rateLimit({
  windowMs,
  max: authMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many login attempts, please try again later.",
});

export const forgotLimiter = rateLimit({
  windowMs,
  max: forgotMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests, please try again later.",
});

export const defaultLimiter = rateLimit({
  windowMs,
  max: defaultMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests, please try again later.",
});
