import { AuditLog } from "../models/AuditLog.js";

export async function logAudit(req, { action, targetType, targetId, meta } = {}) {
  try {
    await AuditLog.create({
      actor: req.user?._id,
      action,
      targetType,
      targetId,
      meta,
      ip: req.ip || req.headers["x-forwarded-for"] || req.connection?.remoteAddress,
      userAgent: req.headers["user-agent"] || undefined,
    });
  } catch (err) {
    // Do not break requests on audit failure; log and continue.
    // eslint-disable-next-line no-console
    console.error("Failed to write audit log:", err);
  }
}
