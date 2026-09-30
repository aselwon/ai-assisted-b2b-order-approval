import { mkdir, writeFile } from "node:fs/promises";
import { ExecArgs } from "@medusajs/framework/types";
import { seedDemo, createDemoCart } from "../lib/demo-data";
import { submitApprovalWorkflow } from "../workflows/approval";
import { processNextAnalysis } from "../agents/execute";
import { APPROVAL_MODULE } from "../modules/approval";
import ApprovalModuleService from "../modules/approval/service";

export default async function verifyLive({ container }: ExecArgs) {
  if (process.env.AGENT_PROVIDER !== "openai")
    throw new Error(
      "Run explicitly with AGENT_PROVIDER=openai; this makes real API calls.",
    );
  const { buyer } = await seedDemo(container);
  const cart = await createDemoCart(container, buyer.id, "clean");
  const { result } = await submitApprovalWorkflow(container).run({
    input: { customer_id: buyer.id, cart_id: cart.id },
  });
  await processNextAnalysis(container, result.id);
  const service = container.resolve<ApprovalModuleService>(APPROVAL_MODULE);
  const [run] = await service.analysisHistory(result.id);
  const request = await service.retrieveApprovalRequest(result.id);
  const report = {
    verified_at: new Date().toISOString(),
    request_id: request.id,
    human_status: request.status,
    provider: run.provider,
    requested_model: run.model,
    analysis_status: run.status,
    recommendation: run.recommendation,
    steps: run.steps.map((step) => ({
      name: step.name,
      status: step.status,
      error_code: step.error_code,
      attempts: step.attempts.map((attempt) => ({
        status: attempt.status,
        model: attempt.model,
        duration_ms: attempt.duration_ms,
        input_tokens: attempt.input_tokens,
        output_tokens: attempt.output_tokens,
        error_code: attempt.error_code,
      })),
    })),
  };
  await mkdir("docs", { recursive: true });
  await writeFile(
    "docs/live-verification.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
  if (run.status !== "completed")
    throw new Error(
      "Live verification failed; inspect the sanitized stage error codes in docs/live-verification.json",
    );
  if (request.status !== "pending")
    throw new Error("Invariant violated: model must never decide a purchase");
}
