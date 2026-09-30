import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { submitApprovalWorkflow } from "../../../workflows/approval";
import ApprovalModuleService from "../../../modules/approval/service";
import { APPROVAL_MODULE } from "../../../modules/approval";
export async function POST(
  req: AuthenticatedMedusaRequest<{ cart_id: string }>,
  res: MedusaResponse,
) {
  const { result } = await submitApprovalWorkflow(req.scope).run({
    input: {
      customer_id: req.auth_context.actor_id,
      cart_id: req.validatedBody.cart_id,
    },
  });
  res.status(201).json({ approval_request: result });
}
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) {
  const service = req.scope.resolve<ApprovalModuleService>(APPROVAL_MODULE);
  const member = await service.membership(req.auth_context.actor_id);
  const [requests, count] = await service.listAndCountApprovalRequests(
    { company_id: member.company_id },
    { order: { created_at: "DESC" }, take: 100 },
  );
  res.json({ approval_requests: requests, count });
}
