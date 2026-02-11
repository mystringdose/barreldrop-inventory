import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";

import { authRouter } from "./routes/auth.js";
import { userRouter } from "./routes/users.js";
import { itemRouter } from "./routes/items.js";
import { stockRouter } from "./routes/stock.js";
import { salesRouter } from "./routes/sales.js";
import { creditRouter } from "./routes/credits.js";
import { reportsRouter } from "./routes/reports.js";
import { auditRouter } from "./routes/audit.js";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function normalizeOrigin(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173")
  .split(",")
  .map(normalizeOrigin)
  .filter(Boolean);

// Required behind CloudFront/reverse proxies so rate limiting and IP handling work correctly.
app.set("trust proxy", process.env.TRUST_PROXY || 1);

app.use(
  cors({
    origin(origin, callback) {
      // Allow same-origin / non-browser requests with no Origin header.
      if (!origin) return callback(null, true);
      const normalized = normalizeOrigin(origin);
      if (allowedOrigins.includes(normalized)) return callback(null, true);
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.use("/auth", authRouter);
app.use("/users", userRouter);
app.use("/items", itemRouter);
app.use("/stock-receipts", stockRouter);
app.use("/sales", salesRouter);
app.use("/credits", creditRouter);
app.use("/reports", reportsRouter);
app.use("/audit", auditRouter);

app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || "Unexpected error",
  });
});

export default app;
