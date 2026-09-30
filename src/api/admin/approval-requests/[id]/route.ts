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
  await service.requireApprover(req.auth_context.actor_id);
  res.json({
    approval_request: await service.retrieveApprovalRequest(req.params.id),
    agent_budget: await service.agentBudget(req.params.id),
    analysis_runs: await service.analysisHistory(req.params.id),
  });
}
