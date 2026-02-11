import mongoose from "mongoose";

const CreditItemSchema = new mongoose.Schema(
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

const CreditSchema = new mongoose.Schema(
  {
    customerName: { type: String, required: true, trim: true },
    customerContact: { type: String, trim: true },
    notes: { type: String },
    items: { type: [CreditItemSchema], required: true },
    totalAmount: { type: Number, required: true },
    totalCost: { type: Number, required: true },
    status: { type: String, enum: ["open", "converted"], default: "open" },
    creditedAt: { type: Date, default: Date.now },
    convertedAt: { type: Date },
    convertedSale: { type: mongoose.Schema.Types.ObjectId, ref: "Sale" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    convertedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export const Credit = mongoose.model("Credit", CreditSchema);
