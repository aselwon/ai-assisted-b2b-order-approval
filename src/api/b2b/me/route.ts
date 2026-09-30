import { analysisConfig } from "../../../agents/provider";
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import ApprovalModuleService from "../../../modules/approval/service";
import { APPROVAL_MODULE } from "../../../modules/approval";
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) {
  const service = req.scope.resolve<ApprovalModuleService>(APPROVAL_MODULE);
  const member = await service.membership(req.auth_context.actor_id);
  res.json({
    agent_config: analysisConfig(),
    member,
    company: await service.retrieveCompany(member.company_id),
  });
}
