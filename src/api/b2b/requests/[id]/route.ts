import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import ApprovalModuleService from "../../../../modules/approval/service";
import { APPROVAL_MODULE } from "../../../../modules/approval";
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) {
  const service = req.scope.resolve<ApprovalModuleService>(APPROVAL_MODULE);
  res.json({
    approval_request: await service.forCustomer(
      req.params.id,
      req.auth_context.actor_id,
    ),
  });
}
