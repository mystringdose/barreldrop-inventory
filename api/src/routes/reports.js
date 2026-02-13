import express from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { Sale } from "../models/Sale.js";
import { Credit } from "../models/Credit.js";
import { buildDateRange } from "../lib/dateRange.js";
import { roundNumber } from "../lib/money.js";

export const reportsRouter = express.Router();

reportsRouter.use(requireAuth);

reportsRouter.get("/sales", async (req, res, next) => {
  try {
    const { start, end, user, tzOffsetMinutes } = req.query;
    const dateRange = buildDateRange({ start, end, tzOffsetMinutes });

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
    const { start, end, tzOffsetMinutes } = req.query;
    const dateRange = buildDateRange({ start, end, tzOffsetMinutes });

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

reportsRouter.get("/credits", async (req, res, next) => {
  try {
    const { start, end, status = "all", user, tzOffsetMinutes } = req.query;
    const dateRange = buildDateRange({ start, end, tzOffsetMinutes });

    const query = {};
    if (dateRange) query.creditedAt = dateRange;
    if (status === "open" || status === "converted") query.status = status;

    if (req.user.role === "admin") {
      if (user && user !== "all") query.createdBy = user;
    } else {
      query.createdBy = req.user._id;
    }

    const credits = await Credit.find(query)
      .sort({ creditedAt: -1, _id: -1 })
      .populate("createdBy", "name email")
      .populate("convertedBy", "name email")
      .populate("convertedSale", "_id soldAt");

    const totals = await Credit.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalCredits: { $sum: 1 },
          openCredits: {
            $sum: { $cond: [{ $eq: ["$status", "open"] }, 1, 0] },
          },
          convertedCredits: {
            $sum: { $cond: [{ $eq: ["$status", "converted"] }, 1, 0] },
          },
          totalCreditedAmount: { $sum: "$totalAmount" },
          totalConvertedAmount: {
            $sum: { $cond: [{ $eq: ["$status", "converted"] }, "$totalAmount", 0] },
          },
          outstandingAmount: {
            $sum: { $cond: [{ $eq: ["$status", "open"] }, "$totalAmount", 0] },
          },
        },
      },
    ]);

    const summary = totals[0] || {
      totalCredits: 0,
      openCredits: 0,
      convertedCredits: 0,
      totalCreditedAmount: 0,
      totalConvertedAmount: 0,
      outstandingAmount: 0,
    };

    const totalCredits = Number(summary.totalCredits || 0);
    const totalCreditedAmount = Number(summary.totalCreditedAmount || 0);
    const convertedCredits = Number(summary.convertedCredits || 0);
    const totalConvertedAmount = Number(summary.totalConvertedAmount || 0);

    summary.countConversionRatePct = totalCredits > 0
      ? roundNumber((convertedCredits / totalCredits) * 100, 2)
      : 0;
    summary.valueConversionRatePct = totalCreditedAmount > 0
      ? roundNumber((totalConvertedAmount / totalCreditedAmount) * 100, 2)
      : 0;

    res.json({ summary, credits });
  } catch (err) {
    next(err);
  }
});
