import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { executeAgent, PipelineState } from "../agents/execute";
import { APPROVAL_MODULE } from "../modules/approval";
import ApprovalModuleService from "../modules/approval/service";

const policyStep = createStep(
  "b2b-policy-agent",
  async (input: PipelineState, { container }) =>
    new StepResponse(await executeAgent(container, input, "policy")),
);
const riskStep = createStep(
  "b2b-risk-agent",
  async (policy: PipelineState, { container }) =>
    new StepResponse(await executeAgent(container, policy, "risk")),
);
const recommendationStep = createStep(
  "b2b-recommendation-agent",
  async (risk: PipelineState, { container }) =>
    new StepResponse(await executeAgent(container, risk, "recommendation")),
);
const finalizeStep = createStep(
  "b2b-finalize-analysis",
  async (input: PipelineState, { container }) => {
    await container
      .resolve<ApprovalModuleService>(APPROVAL_MODULE)
      .finishAnalysis(input.run_id, input.token);
    return new StepResponse({ run_id: input.run_id });
  },
);
// Explicit data dependencies: Risk cannot execute before Policy, nor Recommendation before Risk.
// Completed attempts are an audit trail, deliberately not compensated away on a later failure.
export const analysisWorkflow = createWorkflow(
  "b2b-agent-analysis",
  (input: PipelineState) => {
    const policy = policyStep(input);
    const risk = riskStep(policy);
    const recommendation = recommendationStep(risk);
    return new WorkflowResponse(finalizeStep(recommendation));
  },
);
