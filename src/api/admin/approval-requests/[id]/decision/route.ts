import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { decideApprovalWorkflow } from "../../../../../workflows/approval";
export async function POST(
  req: AuthenticatedMedusaRequest<{
    decision: "approved" | "rejected";
    reason: string;
  }>,
  res: MedusaResponse,
) {
  const { result } = await decideApprovalWorkflow(req.scope).run({
    input: {
      id: req.params.id,
      user_id: req.auth_context.actor_id,
      ...req.validatedBody,
    },
  });
  res.json({ approval_request: result });
}
