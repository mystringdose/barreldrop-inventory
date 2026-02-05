import mongoose from "mongoose";

const AuditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    action: { type: String, required: true },
    targetType: { type: String },
    targetId: { type: mongoose.Schema.Types.ObjectId },
    meta: { type: mongoose.Schema.Types.Mixed },
    ip: { type: String },
    userAgent: { type: String },
  },
  { timestamps: true }
);

export const AuditLog = mongoose.model("AuditLog", AuditLogSchema);
