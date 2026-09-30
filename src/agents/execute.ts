import { preflight } from "./preflight";
import { AGENT_LIMITS, GuardrailError } from "./guardrails";
import { MedusaContainer } from "@medusajs/framework/types";
import { APPROVAL_MODULE } from "../modules/approval";
import ApprovalModuleService from "../modules/approval/service";
import {
  AGENTS,
  AgentInput,
  AgentName,
  AgentOutput,
  validateOutput,
} from "./contracts";
import {
  AgentFailure,
  AgentProvider,
  callWithTimeout,
  DemoProvider,
  OpenAIProvider,
  ProviderResponse,
  timeoutMs,
} from "./provider";

export type PipelineState = { run_id: string; token: string; proceed: boolean };
export function makeProvider(provider: string, model: string): AgentProvider {
  return provider === "demo" ? new DemoProvider() : new OpenAIProvider(model);
}

export async function executeAgent(
  container: MedusaContainer,
  state: PipelineState,
  name: AgentName,
  override?: AgentProvider,
): Promise<PipelineState> {
  if (!state.proceed) return state;
  const service = container.resolve<ApprovalModuleService>(APPROVAL_MODULE);
  const run = await service.retrieveAnalysisRun(state.run_id);
  const steps = await service.listAgentSteps(
    { run_id: run.id },
    { order: { position: "ASC" } },
  );
  const step = steps.find((s) => s.name === name)!;
  if (step.status === "completed") return state; // resume without re-running a completed model call
  if (step.status === "error") return { ...state, proceed: false };
  const previous: Partial<Record<AgentName, AgentOutput>> = {};
  for (const prior of steps.filter((s) => s.position < step.position)) {
    if (prior.status !== "completed" || !prior.output || !prior.input)
      return { ...state, proceed: false };
    // Validate persisted results before crossing the next agent boundary, including after restart.
    try {
      previous[prior.name] = validateOutput(
        prior.output,
        prior.input as unknown as AgentInput,
      );
    } catch {
      await service.stopForGuardrail(
        run.id,
        state.token,
        name,
        "invalid_response",
      );
      return { ...state, proceed: false };
    }
  }
  const input: AgentInput = {
    schema_version: "1",
    agent: name,
    facts: (run.input as any).facts,
    previous,
  };
  const provider = override || makeProvider(run.provider, run.model);
  for (;;) {
    const violation = await preflight(container, run.request_id);
    if (violation) {
      await service.stopForGuardrail(run.id, state.token, name, violation);
      return { ...state, proceed: false };
    }
    const attempt = await service.beginAgentAttempt(
      run.id,
      state.token,
      name,
      input,
    );
    if (!attempt) return { ...state, proceed: false };
    const started = Date.now();
    let response: ProviderResponse | undefined;
    let errorCode: string | undefined;
    let output: AgentOutput | undefined;
    try {
      response = await callWithTimeout(
        provider,
        input,
        {
          scenario: String((run.input as any).scenario),
          run_sequence: run.sequence,
          attempt: attempt.number,
        },
        timeoutMs(),
      );
      try {
        output = validateOutput(response.output, input);
      } catch (error) {
        throw new AgentFailure(
          error instanceof GuardrailError ? error.code : "invalid_response",
        );
      }
    } catch (error) {
      // No raw provider error, payload, credential or stack is persisted in the audit trail.
      errorCode = error instanceof AgentFailure ? error.code : "provider_error";
    }
    await service.finishAgentAttempt(run.id, state.token, attempt.id, {
      error_code: errorCode,
      output,
      duration_ms: Date.now() - started,
      model: response?.model,
      input_tokens: response?.input_tokens,
      output_tokens: response?.output_tokens,
    });
    if (!errorCode) return state;
    if (attempt.number >= AGENT_LIMITS.attemptsPerStep)
      return { ...state, proceed: false };
    const delay = Math.min(
      2000,
      Math.max(0, Number(process.env.AGENT_RETRY_DELAY_MS ?? 300)),
    );
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

/** Used by the scheduled job. Claim and lease fencing live in PostgreSQL, not this process. */
export async function processNextAnalysis(
  container: MedusaContainer,
  requestId?: string,
  override?: AgentProvider,
) {
  const service = container.resolve<ApprovalModuleService>(APPROVAL_MODULE);
  const run = await service.claimAnalysis(requestId);
  if (!run) return false;
  const initial: PipelineState = {
    run_id: run.id,
    token: run.lease_token,
    proceed: true,
  };
  if (override) {
    // Dependency-injected test runner uses exactly the same persisted boundaries and finalizer.
    let state = initial;
    for (const name of AGENTS)
      state = await executeAgent(container, state, name, override);
    await service.finishAnalysis(state.run_id, state.token);
  } else {
    // Lazy import avoids the module cycle between the workflow's steps and this executor.
    const { analysisWorkflow } = require("../workflows/analysis");
    await analysisWorkflow(container).run({ input: initial });
  }
  return true;
}
