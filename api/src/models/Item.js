import mongoose from "mongoose";

const ItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    sku: { type: String, required: true, unique: true },
    category: { type: String, enum: ["whiskey", "wine", "rum", "beer", "vodka", "gin", "other"] },
    size: { type: String },
    abv: { type: Number },
    buyingPrice: { type: Number, default: 0 },
    sellingPrice: { type: Number, default: 0 },
    status: { type: String, enum: ["active", "frozen"], default: "active" },
    reorderLevel: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export const Item = mongoose.model("Item", ItemSchema);
