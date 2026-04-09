/**
 * Authentication middleware for admin-only routes.
 * Uses JWT issued on /admin/auth/login.
 */
import { FastifyRequest, FastifyReply } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    adminId?: string;
    adminEmail?: string;
  }
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
    const payload = req.user as { id: string; email: string; role: string };
    if (payload.role !== "admin") {
      return reply.status(403).send({ success: false, error: "Admin access required" });
    }
    req.adminId = payload.id;
    req.adminEmail = payload.email;
  } catch {
    return reply.status(401).send({ success: false, error: "Invalid or expired token" });
  }
}
