import { AGENT_LIMITS, VIOLATION_MESSAGES } from "../../agents/guardrails";
import { randomUUID } from "node:crypto";
import {
  AnalysisRun,
  AgentStep,
  AgentAttempt,
  PurchaseContext,
  GuardrailViolation,
} from "./models/analysis";
import {
  AGENTS,
  AgentName,
  AgentInput,
  AgentOutput,
} from "../../agents/contracts";
import {
  buildFacts,
  DEFAULT_POLICY,
  enforceRecommendation,
} from "../../agents/policy";
import { analysisConfig } from "../../agents/provider";
import { Context } from "@medusajs/framework/types";
import { EntityManager } from "@medusajs/framework/mikro-orm/knex";
import {
  InjectManager,
  InjectTransactionManager,
  MedusaContext,
  MedusaError,
  MedusaService,
} from "@medusajs/framework/utils";
import { Company } from "./models/company";
import { Member } from "./models/member";
import { Approver } from "./models/approver";
import { ApprovalRequest } from "./models/approval-request";

export type CartSnapshot = {
  id: string;
  customer_id: string | null;
  currency_code: string;
  completed_at?: Date | string | null;
  total: number;
  items: {
    title: string;
    product_description?: string | null;
    quantity: number;
    unit_price: number;
  }[];
};
export type Decision = {
  id: string;
  user_id: string;
  decision: "approved" | "rejected";
  reason: string;
};

export class LeaseLostError extends Error {
  constructor() {
    super("Analysis lease lost");
    this.name = "LeaseLostError";
  }
}
export type AttemptResult = {
  error_code?: string;
  duration_ms: number;
  model?: string;
  input_tokens?: number | null;
  output_tokens?: number | null;
  output?: AgentOutput;
};

class ApprovalModuleService extends MedusaService({
  Company,
  Member,
  Approver,
  ApprovalRequest,
  AnalysisRun,
  AgentStep,
  AgentAttempt,
  PurchaseContext,
  GuardrailViolation,
}) {
  async membership(customerId: string, context?: Context<EntityManager>) {
    const [member] = await this.listMembers(
      { customer_id: customerId },
      {},
      context,
    );
    if (!member)
      throw new MedusaError(
        MedusaError.Types.FORBIDDEN,
        "No company membership",
      );
    return member;
  }

  async requireApprover(userId: string, context?: Context<EntityManager>) {
    const [grant] = await this.listApprovers(
      { user_id: userId, enabled: true },
      {},
      context,
    );
    if (!grant)
      throw new MedusaError(
        MedusaError.Types.FORBIDDEN,
        "Order approval permission required",
      );
  }

  async forCustomer(id: string, customerId: string) {
    const member = await this.membership(customerId);
    // Filter by the authenticated customer's company. Do not reveal other tenants' IDs.
    const [request] = await this.listApprovalRequests({
      id,
      company_id: member.company_id,
    });
    if (!request)
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "Approval request not found",
      );
    return request;
  }

  @InjectManager()
  async submit(
    customerId: string,
    cart: CartSnapshot,
    @MedusaContext() context?: Context<EntityManager>,
  ) {
    try {
      return await this.submit_(customerId, cart, context);
    } catch (error: any) {
      // Medusa 2.21 maps unique violations to INVALID_DATA and strips the PG code.
      // After rollback, verify the durable duplicate in this customer's scope.
      const duplicate =
        error.type === MedusaError.Types.INVALID_DATA
          ? (
              await this.listApprovalRequests({
                cart_id: cart.id,
                customer_id: customerId,
              })
            ).length > 0
          : false;
      if (
        duplicate ||
        error.type === MedusaError.Types.DUPLICATE_ERROR ||
        error.code === "23505" ||
        error.cause?.code === "23505" ||
        error.name === "UniqueConstraintViolationException"
      ) {
        throw new MedusaError(
          MedusaError.Types.CONFLICT,
          "This cart already has an approval request. Create a new cart for a new request.",
        );
      }
      throw error;
    }
  }

  @InjectTransactionManager()
  protected async submit_(
    customerId: string,
    cart: CartSnapshot,
    @MedusaContext() context?: Context<EntityManager>,
  ) {
    const member = await this.membership(customerId, context);
    if (!member.can_submit)
      throw new MedusaError(
        MedusaError.Types.FORBIDDEN,
        "Submission permission required",
      );
    if (cart.customer_id !== customerId)
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "Cart not found");
    if (cart.completed_at || !cart.items?.length)
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "An open, non-empty cart is required",
      );
    if (
      cart.items.length > 20 ||
      cart.items.some(
        (item) =>
          !Number.isSafeInteger(Number(item.quantity)) ||
          Number(item.quantity) <= 0 ||
          !Number.isFinite(Number(item.unit_price)) ||
          Number(item.unit_price) < 0,
      )
    )
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Invalid cart items or more than 20 lines",
      );
    const company = await this.retrieveCompany(member.company_id, {}, context);
    // Medusa v2 totals are in major currency units. This demo deliberately supports PLN only.
    const amountMinor = Math.round(Number(cart.total) * 100);
    if (
      cart.currency_code !== "pln" ||
      cart.currency_code !== company.currency_code ||
      !Number.isSafeInteger(amountMinor) ||
      amountMinor <= 0 ||
      amountMinor > 2_000_000_000
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Invalid cart total or unsupported currency",
      );
    }
    if (amountMinor <= company.approval_limit_minor)
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Cart does not exceed the company approval limit",
      );
    const [purchase] = await this.listPurchaseContexts(
      { cart_id: cart.id },
      {},
      context,
    );
    const request = await this.createApprovalRequests(
      {
        company_id: company.id,
        company_name: company.name,
        customer_id: customerId,
        cart_id: cart.id,
        amount_minor: amountMinor,
        currency_code: cart.currency_code,
        limit_minor: company.approval_limit_minor,
        status: "pending",
        snapshot: {
          captured_at: new Date().toISOString(),
          items: cart.items,
          total: Number(cart.total),
          currency_code: cart.currency_code,
          policy: company.policy || DEFAULT_POLICY,
          purchase_context: purchase?.data || {},
          scenario: purchase?.scenario || "clean",
        },
      },
      context,
    );
    return this.queueAnalysis_(request, context!);
  }

  @InjectManager()
  async decide(
    input: Decision,
    @MedusaContext() context?: Context<EntityManager>,
  ) {
    return await this.decide_(input, context);
  }

  @InjectTransactionManager()
  protected async decide_(
    input: Decision,
    @MedusaContext() context?: Context<EntityManager>,
  ) {
    await this.requireApprover(input.user_id, context);
    if (
      !["approved", "rejected"].includes(input.decision) ||
      !input.reason.trim() ||
      input.reason.trim().length > 1000
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "A decision and a reason of 1–1000 characters are required",
      );
    }
    const [request] = await context!.transactionManager!.execute(
      "SELECT * FROM approval_request WHERE id = ? AND deleted_at IS NULL FOR UPDATE",
      [input.id],
    );
    if (!request)
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "Approval request not found",
      );
    if (request.status !== "pending")
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "This request has already been decided",
      );
    if (
      !request.current_run_id ||
      !["completed", "error"].includes(request.analysis_status)
    ) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "Wait for the analysis to finish or fail before the human decision",
      );
    }
    const run = await this.retrieveAnalysisRun(
      request.current_run_id,
      {},
      context,
    );
    const facts = (run.input as any).facts;
    const inputViolations = await this.listGuardrailViolations(
      { run_id: run.id },
      { take: 100 },
      context,
    );
    const invalidInput = inputViolations.some((v) =>
      [
        "identity_invalid",
        "company_access_denied",
        "cart_invalid",
        "preflight_unavailable",
      ].includes(v.code),
    );
    if (
      input.decision === "approved" &&
      (facts.blockers.length || invalidInput)
    ) {
      throw new MedusaError(
        MedusaError.Types.FORBIDDEN,
        "Deterministic policy blocks approval: " + facts.blockers.join(", "),
      );
    }
    // Compare-and-set in PostgreSQL: concurrent requests cannot both decide, even across processes.
    // The decision, actor, reason and timestamp are committed together, with no follow-up writes.
    const rows = await context!.transactionManager!.execute(
      `UPDATE approval_request SET status = ?, reason = ?, decided_by = ?, decision_run_id = current_run_id, decided_at = now(), updated_at = now()
       WHERE id = ? AND status = 'pending' AND deleted_at IS NULL RETURNING *`,
      [input.decision, input.reason.trim(), input.user_id, input.id],
    );
    if (!rows.length) {
      const [existing] = await this.listApprovalRequests(
        { id: input.id },
        {},
        context,
      );
      if (!existing)
        throw new MedusaError(
          MedusaError.Types.NOT_FOUND,
          "Approval request not found",
        );
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "This request has already been decided",
      );
    }
    return rows[0];
  }
  /** Queue and all three stage records are committed with the purchase request. */
  protected async queueAnalysis_(
    request: any,
    context: Context<EntityManager>,
  ) {
    // These cross-record FK columns are scalar DML fields. Flush in dependency order
    // inside the same transaction so MikroORM never inserts a step before its run.
    await context.transactionManager!.flush();
    const previous = await this.listAnalysisRuns(
      { request_id: request.id },
      {},
      context,
    );
    if (previous.length >= AGENT_LIMITS.runsPerRequest)
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Maximum of three analysis runs reached",
      );
    const reference = request.snapshot.purchase_context?.purchase_ref;
    const duplicates = reference
      ? await context.transactionManager!.execute(
          `SELECT count(*)::int AS count FROM approval_request
       WHERE company_id = ? AND id <> ? AND deleted_at IS NULL
       AND created_at > now() - interval '30 days' AND snapshot->'purchase_context'->>'purchase_ref' = ?`,
          [request.company_id, request.id, reference],
        )
      : [{ count: 0 }];
    const config = analysisConfig();
    const run = await this.createAnalysisRuns(
      {
        request_id: request.id,
        sequence: previous.length + 1,
        provider: config.provider,
        model: config.model,
        prompt_version: "b2b-v2-guardrails",
        input: {
          facts: buildFacts(request, Number(duplicates[0].count)),
          scenario: request.snapshot.scenario || "clean",
        },
        status: "waiting",
      },
      context,
    );
    await context.transactionManager!.flush();
    await this.createAgentSteps(
      AGENTS.map((name, index) => ({
        run_id: run.id,
        name,
        position: index + 1,
        status: "waiting" as const,
      })),
      context,
    );
    await context.transactionManager!.flush();
    if ((run.input as any).facts.warnings.includes("UNTRUSTED_INSTRUCTION")) {
      await this.recordViolation_(
        run,
        "untrusted_instruction",
        "input",
        context,
      );
    }
    return await this.updateApprovalRequests(
      {
        id: request.id,
        current_run_id: run.id,
        analysis_status: "waiting",
        recommendation: null,
      },
      context,
    );
  }

  @InjectManager()
  async retryAnalysis(
    requestId: string,
    userId: string,
    @MedusaContext() context?: Context<EntityManager>,
  ) {
    const result = await this.retryAnalysis_(requestId, userId, context);
    if ("retry_blocked" in result)
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        result.retry_blocked as string,
      );
    return result;
  }

  @InjectTransactionManager()
  protected async retryAnalysis_(
    requestId: string,
    userId: string,
    @MedusaContext() context?: Context<EntityManager>,
  ) {
    await this.requireApprover(userId, context);
    const [request] = await context!.transactionManager!.execute(
      "SELECT * FROM approval_request WHERE id = ? AND deleted_at IS NULL FOR UPDATE",
      [requestId],
    );
    if (!request)
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "Approval request not found",
      );
    if (request.status !== "pending")
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "A decided request cannot be re-analyzed",
      );
    if (request.current_run_id) {
      const run = await this.retrieveAnalysisRun(
        request.current_run_id,
        {},
        context,
      );
      if (run.status !== "error")
        throw new MedusaError(
          MedusaError.Types.CONFLICT,
          "Only a failed analysis can be retried",
        );
    }
    const priorRuns = await this.listAnalysisRuns(
      { request_id: request.id },
      {},
      context,
    );
    const used = await this.callsUsed_(
      request.id,
      context!.transactionManager!,
    );
    const limitCode =
      used >= AGENT_LIMITS.callsPerRequest
        ? "call_limit_exceeded"
        : priorRuns.length >= AGENT_LIMITS.runsPerRequest
          ? "run_limit_exceeded"
          : null;
    if (limitCode && request.current_run_id) {
      const current = await this.retrieveAnalysisRun(
        request.current_run_id,
        {},
        context,
      );
      await this.recordViolation_(current, limitCode, "budget", context!);
      await this.updateApprovalRequests(
        { id: request.id, recommendation: "manual_review" },
        context,
      );
      await this.updateAnalysisRuns(
        { id: current.id, recommendation: "manual_review" },
        context,
      );
      return { retry_blocked: VIOLATION_MESSAGES[limitCode] };
    }
    return this.queueAnalysis_(request, context!);
  }

  private async callsUsed_(requestId: string, em: EntityManager) {
    const [row] = await em.execute(
      `SELECT count(*)::int AS used FROM approval_agent_attempt a JOIN approval_analysis_run r ON r.id = a.run_id WHERE r.request_id = ?`,
      [requestId],
    );
    return Number(row.used);
  }

  async agentBudget(requestId: string) {
    const runs = await this.listAnalysisRuns(
      { request_id: requestId },
      { take: 100 },
    );
    let used = 0;
    for (const run of runs)
      used += (await this.listAndCountAgentAttempts({ run_id: run.id }))[1];
    return {
      used,
      limit: AGENT_LIMITS.callsPerRequest,
      attempts_per_step: AGENT_LIMITS.attemptsPerStep,
      runs_limit: AGENT_LIMITS.runsPerRequest,
    };
  }

  protected async recordViolation_(
    run: { id: string; request_id: string },
    code: string,
    phase: "input" | "output" | "budget" | "execution",
    context: Context<EntityManager>,
    stepId?: string,
    attemptId?: string,
  ) {
    if (!attemptId) {
      const [existing] = await this.listGuardrailViolations(
        { run_id: run.id, code },
        {},
        context,
      );
      if (existing) return existing;
    }
    return this.createGuardrailViolations(
      {
        request_id: run.request_id,
        run_id: run.id,
        step_id: stepId || null,
        attempt_id: attemptId || null,
        code,
        phase,
        detail:
          VIOLATION_MESSAGES[code] ||
          "Execution failed safely; no output was accepted.",
      },
      context,
    );
  }

  @InjectManager()
  async stopForGuardrail(
    runId: string,
    token: string,
    name: AgentName,
    code: string,
    @MedusaContext() context?: Context<EntityManager>,
  ) {
    return this.stopForGuardrail_(runId, token, name, code, context);
  }

  @InjectTransactionManager()
  protected async stopForGuardrail_(
    runId: string,
    token: string,
    name: AgentName,
    code: string,
    @MedusaContext() context?: Context<EntityManager>,
  ) {
    const run = await this.lease_(runId, token, context!.transactionManager!);
    const [step] = await this.listAgentSteps(
      { run_id: runId, name },
      {},
      context,
    );
    await this.recordViolation_(
      run,
      code,
      code === "invalid_response" ? "output" : "input",
      context!,
      step.id,
    );
    await this.updateAgentSteps(
      {
        id: step.id,
        status: "error",
        error_code: code,
        finished_at: new Date(),
      },
      context,
    );
  }

  async analysisHistory(requestId: string) {
    const runs = await this.listAnalysisRuns(
      { request_id: requestId },
      { order: { sequence: "DESC" } },
    );
    return Promise.all(
      runs.map(async ({ lease_token, lease_until, ...run }) => ({
        ...run,
        violations: await this.listGuardrailViolations(
          { run_id: run.id },
          { order: { created_at: "ASC" }, take: 100 },
        ),
        steps: await Promise.all(
          (
            await this.listAgentSteps(
              { run_id: run.id },
              { order: { position: "ASC" } },
            )
          ).map(async (step) => ({
            ...step,
            attempts: await this.listAgentAttempts(
              { step_id: step.id },
              { order: { number: "ASC" } },
            ),
          })),
        ),
      })),
    );
  }

  @InjectManager()
  async claimAnalysis(
    requestId?: string,
    @MedusaContext() context?: Context<EntityManager>,
  ) {
    return this.claimAnalysis_(requestId, context);
  }

  @InjectTransactionManager()
  protected async claimAnalysis_(
    requestId?: string,
    @MedusaContext() context?: Context<EntityManager>,
  ) {
    const em = context!.transactionManager!;
    const [run] = await em.execute(
      `SELECT r.* FROM approval_analysis_run r
       JOIN approval_request q ON q.current_run_id = r.id AND q.status = 'pending'
       WHERE r.deleted_at IS NULL AND q.deleted_at IS NULL
       AND (r.status = 'waiting' OR (r.status = 'running' AND r.lease_until < now()))
       ${requestId ? "AND r.request_id = ?" : ""}
       ORDER BY r.created_at LIMIT 1 FOR UPDATE OF r SKIP LOCKED`,
      requestId ? [requestId] : [],
    );
    if (!run) return null;
    const token = randomUUID();
    await em.execute(
      `UPDATE approval_analysis_run SET status = 'running', lease_token = ?, lease_until = now() + interval '90 seconds', started_at = coalesce(started_at, now()), updated_at = now() WHERE id = ?`,
      [token, run.id],
    );
    await em.execute(
      `UPDATE approval_request SET analysis_status = 'running', updated_at = now() WHERE id = ?`,
      [run.request_id],
    );
    // A previous worker may have died after sending a request. Preserve the interrupted
    // attempt and count it toward the retry budget; stale workers are fenced out below.
    await em.execute(
      `UPDATE approval_agent_attempt SET status = 'error', error_code = 'worker_interrupted', finished_at = now(), duration_ms = least(2147483647, extract(epoch from (now() - started_at)) * 1000)::int WHERE run_id = ? AND status = 'running'`,
      [run.id],
    );
    await em.execute(
      `UPDATE approval_agent_step s SET status = CASE WHEN (SELECT count(*) FROM approval_agent_attempt a WHERE a.step_id = s.id) >= 2 THEN 'error' ELSE 'waiting' END, error_code = 'worker_interrupted', updated_at = now() WHERE run_id = ? AND status = 'running'`,
      [run.id],
    );
    return {
      id: String(run.id),
      status: "running",
      lease_token: String(token),
    };
  }

  private async lease_(runId: string, token: string, em: EntityManager) {
    const rows = await em.execute(
      `UPDATE approval_analysis_run SET lease_until = now() + interval '90 seconds' WHERE id = ? AND lease_token = ? AND status = 'running' AND lease_until > now() RETURNING *`,
      [runId, token],
    );
    if (!rows.length) throw new LeaseLostError();
    return rows[0] as {
      id: string;
      request_id: string;
      input: any;
      provider: string;
      model: string;
    };
  }

  @InjectManager()
  async beginAgentAttempt(
    runId: string,
    token: string,
    name: AgentName,
    input: AgentInput,
    @MedusaContext() context?: Context<EntityManager>,
  ) {
    return this.beginAgentAttempt_(runId, token, name, input, context);
  }

  @InjectTransactionManager()
  protected async beginAgentAttempt_(
    runId: string,
    token: string,
    name: AgentName,
    input: AgentInput,
    @MedusaContext() context?: Context<EntityManager>,
  ) {
    const run = await this.lease_(runId, token, context!.transactionManager!);
    const steps = await this.listAgentSteps(
      { run_id: runId },
      { order: { position: "ASC" } },
      context,
    );
    const step = steps.find((s) => s.name === name)!;
    if (step.status === "completed") return null;
    if (
      steps.some((s) => s.position < step.position && s.status !== "completed")
    )
      throw new Error("Upstream stage is not complete");
    const attempts = await this.listAgentAttempts(
      { step_id: step.id },
      {},
      context,
    );
    if (attempts.length >= AGENT_LIMITS.attemptsPerStep) return null;
    const [request] = await context!.transactionManager!.execute(
      "SELECT * FROM approval_request WHERE id = ? FOR UPDATE",
      [run.request_id],
    );
    const [member] = await this.listMembers(
      {
        customer_id: request.customer_id,
        company_id: request.company_id,
        can_submit: true,
      },
      {},
      context,
    );
    const code = !member
      ? "company_access_denied"
      : (await this.callsUsed_(run.request_id, context!.transactionManager!)) >=
          AGENT_LIMITS.callsPerRequest
        ? "call_limit_exceeded"
        : null;
    if (code) {
      await this.recordViolation_(
        run,
        code,
        code === "call_limit_exceeded" ? "budget" : "input",
        context!,
        step.id,
      );
      await this.updateAgentSteps(
        {
          id: step.id,
          status: "error",
          error_code: code,
          finished_at: new Date(),
        },
        context,
      );
      return null;
    }
    await this.updateAgentSteps(
      {
        id: step.id,
        status: "running",
        input: input as any,
        started_at: step.started_at || new Date(),
      },
      context,
    );
    return this.createAgentAttempts(
      {
        run_id: runId,
        step_id: step.id,
        number: attempts.length + 1,
        status: "running",
        provider: run.provider,
        model: run.model,
        started_at: new Date(),
      },
      context,
    );
  }

  @InjectManager()
  async finishAgentAttempt(
    runId: string,
    token: string,
    attemptId: string,
    result: AttemptResult,
    @MedusaContext() context?: Context<EntityManager>,
  ) {
    return this.finishAgentAttempt_(runId, token, attemptId, result, context);
  }

  @InjectTransactionManager()
  protected async finishAgentAttempt_(
    runId: string,
    token: string,
    attemptId: string,
    result: AttemptResult,
    @MedusaContext() context?: Context<EntityManager>,
  ) {
    await this.lease_(runId, token, context!.transactionManager!);
    const attempt = await this.retrieveAgentAttempt(attemptId, {}, context);
    if (attempt.run_id !== runId || attempt.status !== "running")
      throw new LeaseLostError();
    await this.updateAgentAttempts(
      {
        id: attemptId,
        status: result.error_code ? "error" : "completed",
        finished_at: new Date(),
        duration_ms: result.duration_ms,
        input_tokens: result.input_tokens ?? null,
        output_tokens: result.output_tokens ?? null,
        model: result.model || attempt.model,
        error_code: result.error_code || null,
        output: (result.output as any) || null,
      },
      context,
    );
    if (result.error_code) {
      const run = await this.retrieveAnalysisRun(runId, {}, context);
      await this.recordViolation_(
        run,
        result.error_code,
        ["invalid_response", "recommendation_conflict"].includes(
          result.error_code,
        )
          ? "output"
          : "execution",
        context!,
        attempt.step_id,
        attempt.id,
      );
    }
    await this.updateAgentSteps(
      {
        id: attempt.step_id,
        status: result.error_code
          ? attempt.number >= 2
            ? "error"
            : "waiting"
          : "completed",
        error_code: result.error_code || null,
        output: (result.output as any) || null,
        finished_at:
          !result.error_code || attempt.number >= 2 ? new Date() : null,
      },
      context,
    );
  }

  @InjectManager()
  async finishAnalysis(
    runId: string,
    token: string,
    @MedusaContext() context?: Context<EntityManager>,
  ) {
    return this.finishAnalysis_(runId, token, context);
  }

  @InjectTransactionManager()
  protected async finishAnalysis_(
    runId: string,
    token: string,
    @MedusaContext() context?: Context<EntityManager>,
  ) {
    const em = context!.transactionManager!;
    const run = await this.lease_(runId, token, em);
    const steps = await this.listAgentSteps(
      { run_id: runId },
      { order: { position: "ASC" } },
      context,
    );
    const failed = steps.some((step) => step.status !== "completed");
    const final = steps.find((step) => step.name === "recommendation")
      ?.output as AgentOutput | null;
    const guard = failed
      ? {
          recommendation: "manual_review" as const,
          suggested: null,
          reasons: ["AGENT_FAILURE"],
        }
      : enforceRecommendation(
          run.input.facts,
          final!.recommendation,
          steps
            .filter((step) => step.name !== "recommendation")
            .map((step) => {
              const output = step.output as AgentOutput;
              return output.uncertainty.length
                ? "manual_review"
                : output.recommendation;
            }),
        );
    const summary = failed
      ? "An agent failed or was interrupted. Human review is required; no purchase has been approved."
      : final!.rationale;
    if (failed)
      await em.execute(
        `UPDATE approval_agent_step SET status = 'error', error_code = coalesce(error_code, 'upstream_failed'), finished_at = coalesce(finished_at, now()) WHERE run_id = ? AND status <> 'completed'`,
        [runId],
      );
    await this.updateAnalysisRuns(
      {
        id: runId,
        status: failed ? "error" : "completed",
        recommendation: guard.recommendation,
        summary,
        guardrails: guard,
        finished_at: new Date(),
        lease_token: null,
        lease_until: null,
      },
      context,
    );
    await this.updateApprovalRequests(
      {
        id: run.request_id,
        analysis_status: failed ? "error" : "completed",
        recommendation: guard.recommendation,
      },
      context,
    );
  }
}
export default ApprovalModuleService;
