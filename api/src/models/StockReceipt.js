import mongoose from "mongoose";

const StockReceiptSchema = new mongoose.Schema(
  {
    item: { type: mongoose.Schema.Types.ObjectId, ref: "Item", required: true },
    quantity: { type: Number, required: true },
    remainingQuantity: { type: Number, required: true },
    unitCost: { type: Number, required: true },
    invoiceFile: { type: String },
    invoiceKey: { type: String },
    invoiceStorage: { type: String, enum: ["local", "s3"], default: "local" },
    supplier: { type: String },
    purchasedAt: { type: Date, default: Date.now },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export const StockReceipt = mongoose.model("StockReceipt", StockReceiptSchema);
