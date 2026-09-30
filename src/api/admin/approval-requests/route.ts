import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import ApprovalModuleService from "../../../modules/approval/service";
import { APPROVAL_MODULE } from "../../../modules/approval";
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) {
  const service = req.scope.resolve<ApprovalModuleService>(APPROVAL_MODULE);
  await service.requireApprover(req.auth_context.actor_id);
  const status = req.query.status as string | undefined;
  if (status && !["pending", "approved", "rejected"].includes(status))
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Invalid status");
  const offset = Number(req.query.offset || 0);
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Invalid offset");
  const [requests, count] = await service.listAndCountApprovalRequests(
    status ? { status: status as "pending" | "approved" | "rejected" } : {},
    { order: { created_at: "DESC" }, take: 20, skip: offset },
  );
  res.json({ approval_requests: requests, count, offset, limit: 20 });
}
