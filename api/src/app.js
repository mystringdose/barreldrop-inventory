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
import { reportsRouter } from "./routes/reports.js";
import { auditRouter } from "./routes/audit.js";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
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
