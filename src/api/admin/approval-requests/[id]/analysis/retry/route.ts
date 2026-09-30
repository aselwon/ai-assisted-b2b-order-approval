import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { APPROVAL_MODULE } from "../../../../../../modules/approval";
import ApprovalModuleService from "../../../../../../modules/approval/service";
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) {
  const service = req.scope.resolve<ApprovalModuleService>(APPROVAL_MODULE);
  const request = await service.retryAnalysis(
    req.params.id,
    req.auth_context.actor_id,
  );
  res.status(202).json({ approval_request: request });
}
