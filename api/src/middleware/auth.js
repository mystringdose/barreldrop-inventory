import jwt from "jsonwebtoken";
import { User } from "../models/User.js";

function getTokenFromRequest(req) {
  if (req.cookies?.token) return req.cookies.token;
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return null;
}

export async function requireAuth(req, res, next) {
  try {
    const token = getTokenFromRequest(req);
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub).lean();
    if (!user || !user.active) return res.status(401).json({ error: "Unauthorized" });

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (req.user.role !== role) return res.status(403).json({ error: "Forbidden" });
    next();
  };
}
