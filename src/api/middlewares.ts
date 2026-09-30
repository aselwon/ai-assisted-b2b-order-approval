import {
  authenticate,
  defineMiddlewares,
  validateAndTransformBody,
} from "@medusajs/framework/http";
import { z } from "@medusajs/framework/zod";
export default defineMiddlewares({
  routes: [
    {
      matcher: "/b2b/*",
      middlewares: [authenticate("customer", ["bearer", "session"])],
    },
    {
      matcher: "/b2b/requests",
      method: "POST",
      middlewares: [
        validateAndTransformBody(
          z.object({ cart_id: z.string().min(1).max(100) }).strict(),
        ),
      ],
    },
    {
      matcher: "/b2b/carts",
      method: "POST",
      middlewares: [
        validateAndTransformBody(
          z
            .object({
              basket: z.enum([
                "over-limit",
                "under-limit",
                "clean",
                "manual",
                "failure",
                "injection",
              ]),
            })
            .strict(),
        ),
      ],
    },
    {
      matcher: "/admin/approval-requests*",
      middlewares: [authenticate("user", ["session", "bearer"])],
    },
    {
      matcher: "/admin/approval-requests/:id/analysis/retry",
      method: "POST",
      middlewares: [validateAndTransformBody(z.object({}).strict())],
    },
    {
      matcher: "/admin/approval-requests/:id/decision",
      method: "POST",
      middlewares: [
        validateAndTransformBody(
          z
            .object({
              decision: z.enum(["approved", "rejected"]),
              reason: z.string().trim().min(1).max(1000),
            })
            .strict(),
        ),
      ],
    },
  ],
});
