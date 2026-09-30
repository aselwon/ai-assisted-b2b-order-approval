import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { createDemoCart } from "../../../lib/demo-data";
export async function POST(
  req: AuthenticatedMedusaRequest<{
    basket: "over-limit" | "under-limit" | "clean" | "manual" | "failure" | "injection";
  }>,
  res: MedusaResponse,
) {
  const cart = await createDemoCart(
    req.scope,
    req.auth_context.actor_id,
    req.validatedBody.basket,
  );
  res.status(201).json({ cart });
}
