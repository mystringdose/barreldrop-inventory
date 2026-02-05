import express from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { Sale } from "../models/Sale.js";

export const reportsRouter = express.Router();

reportsRouter.use(requireAuth);

function buildDateRange(start, end) {
  const range = {};
  if (start) range.$gte = new Date(start);
  if (end) {
    // Make the end date inclusive for the whole day
    const d = new Date(end);
    d.setHours(23, 59, 59, 999);
    range.$lte = d;
  }
  return Object.keys(range).length ? range : null;
}

reportsRouter.get("/sales", async (req, res, next) => {
  try {
    const { start, end, user } = req.query;
    const dateRange = buildDateRange(start, end);

    const query = {};
    if (dateRange) query.soldAt = dateRange;

    if (req.user.role === "admin") {
      if (user && user !== "all") query.createdBy = user;
    } else {
      query.createdBy = req.user._id;
    }

    const sales = await Sale.find(query).populate("items.item", "name sku");
    res.json({ sales });
  } catch (err) {
    next(err);
  }
});

reportsRouter.get("/profit-loss", requireRole("admin"), async (req, res, next) => {
  try {
    const { start, end } = req.query;
    const dateRange = buildDateRange(start, end);

    const match = dateRange ? { soldAt: dateRange } : {};
    const totals = await Sale.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: "$totalRevenue" },
          totalCost: { $sum: "$totalCost" },
          totalProfit: { $sum: "$profit" },
        },
      },
    ]);

    const result = totals[0] || { totalRevenue: 0, totalCost: 0, totalProfit: 0 };
    res.json({ profitLoss: result });
  } catch (err) {
    next(err);
  }
});

