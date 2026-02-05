import mongoose from "mongoose";

const SaleItemSchema = new mongoose.Schema(
  {
    item: { type: mongoose.Schema.Types.ObjectId, ref: "Item", required: true },
    quantity: { type: Number, required: true },
    unitPrice: { type: Number, required: true },
    unitCost: { type: Number, required: true },
    lineTotal: { type: Number, required: true },
    lineCost: { type: Number, required: true },
  },
  { _id: false }
);

const SaleSchema = new mongoose.Schema(
  {
    items: { type: [SaleItemSchema], required: true },
    totalRevenue: { type: Number, required: true },
    totalCost: { type: Number, required: true },
    profit: { type: Number, required: true },
    soldAt: { type: Date, default: Date.now },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    notes: { type: String },
  },
  { timestamps: true }
);

export const Sale = mongoose.model("Sale", SaleSchema);
