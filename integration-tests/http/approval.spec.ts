import { INJECTION_DESCRIPTION } from "../../src/agents/guardrails";
import { processNextAnalysis } from "../../src/agents/execute";
import {
  AgentFailure,
  AgentProvider,
  DemoProvider,
} from "../../src/agents/provider";
import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { seedDemo, DEMO_PASSWORD } from "../../src/lib/demo-data";
import { APPROVAL_MODULE } from "../../src/modules/approval";
import ApprovalModuleService from "../../src/modules/approval/service";

jest.setTimeout(120_000);
medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, getContainer }) => {
    let buyer: string,
      outsider: string,
      manager: string,
      staff: string,
      viewer: string;
    let fixtures: Awaited<ReturnType<typeof seedDemo>>;
    const config = (token?: string) => ({
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      validateStatus: () => true,
    });
    const post = (path: string, body: object, token?: string) =>
      api.post(path, body, config(token));
    const get = (path: string, token?: string) => api.get(path, config(token));
    async function login(actor: string, email: string) {
      const response = await post(`/auth/${actor}/emailpass`, {
        email,
        password: DEMO_PASSWORD,
      });
      expect(response.status).toBe(200);
      expect(response.data.token).toBeTruthy();
      return response.data.token;
    }
    async function cart(token = buyer, basket = "over-limit") {
      const response = await post("/b2b/carts", { basket }, token);
      expect(response.status).toBe(201);
      return response.data.cart;
    }
    async function submit(token = buyer) {
      const c = await cart(token);
      const response = await post("/b2b/requests", { cart_id: c.id }, token);
      expect(response.status).toBe(201);
      await processNextAnalysis(
        getContainer(),
        response.data.approval_request.id,
      );
      return response.data.approval_request;
    }
    beforeEach(async () => {
      fixtures = await seedDemo(getContainer());
      buyer = await login("customer", "buyer@acme.demo");
      outsider = await login("customer", "buyer@other.demo");
      viewer = await login("customer", "viewer@acme.demo");
      manager = await login("user", "approver@rigby.demo");
      staff = await login("user", "staff@rigby.demo");
    });

    it("submits an above-limit cart with server-derived company, total and immutable limit", async () => {
      const request = await submit();
      expect(request).toMatchObject({
        company_id: "company_acme",
        customer_id: fixtures.buyer.id,
        amount_minor: 135000,
        currency_code: "pln",
        limit_minor: 100000,
        status: "pending",
      });
      expect(request.decided_at ?? null).toBeNull();
      expect(request.snapshot.items).toEqual([
        expect.objectContaining({ quantity: 3, unit_price: 450 }),
      ]);
      const service =
        getContainer().resolve<ApprovalModuleService>(APPROVAL_MODULE);
      await service.updateCompanies({
        id: "company_acme",
        approval_limit_minor: 200000,
      });
      const saved = await get(`/b2b/requests/${request.id}`, buyer);
      expect(saved.status).toBe(200);
      expect(saved.data.approval_request.limit_minor).toBe(100000);
      const medusaCart = await getContainer()
        .resolve(Modules.CART)
        .retrieveCart(request.cart_id);
      expect(medusaCart.completed_at).toBeNull();
    });

    it.each(["approved", "rejected"])(
      "records %s with actor, date and reason",
      async (decision) => {
        const request = await submit();
        const response = await post(
          `/admin/approval-requests/${request.id}/decision`,
          { decision, reason: "  Budget reviewed  " },
          manager,
        );
        expect(response.status).toBe(200);
        expect(response.data.approval_request).toMatchObject({
          status: decision,
          decided_by: fixtures.manager.id,
          reason: "Budget reviewed",
        });
        expect(response.data.approval_request.decided_at).toBeTruthy();
        const saved = await get(`/b2b/requests/${request.id}`, buyer);
        expect(saved.data.approval_request.status).toBe(decision);
      },
    );

    it("rejects a second decision and preserves the first audit record", async () => {
      const request = await submit();
      const path = `/admin/approval-requests/${request.id}/decision`;
      const first = await post(
        path,
        { decision: "approved", reason: "Within project budget" },
        manager,
      );
      expect(first.status).toBe(200);
      const second = await post(
        path,
        { decision: "rejected", reason: "Changed my mind" },
        manager,
      );
      expect(second.status).toBe(409);
      const saved = (await get(`/b2b/requests/${request.id}`, buyer)).data
        .approval_request;
      expect(saved.status).toBe("approved");
      expect(saved.reason).toBe("Within project budget");
      expect(saved.decided_at).toBe(first.data.approval_request.decided_at);
    });

    it("allows exactly one of two concurrent decisions", async () => {
      const request = await submit();
      const path = `/admin/approval-requests/${request.id}/decision`;
      const responses = await Promise.all([
        post(path, { decision: "approved", reason: "Race A" }, manager),
        post(path, { decision: "rejected", reason: "Race B" }, manager),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
      const winner = responses.find((r) => r.status === 200)!.data
        .approval_request;
      const saved = (await get(`/b2b/requests/${request.id}`, buyer)).data
        .approval_request;
      expect(saved).toMatchObject({
        status: winner.status,
        reason: winner.reason,
        decided_by: fixtures.manager.id,
      });
    });

    it("blocks reading another company and submitting its cart", async () => {
      const request = await submit();
      expect((await get(`/b2b/requests/${request.id}`, outsider)).status).toBe(
        404,
      );
      expect(
        (await get("/b2b/requests", outsider)).data.approval_requests,
      ).toEqual([]);
      const foreignCart = await cart();
      expect(
        (await post("/b2b/requests", { cart_id: foreignCart.id }, outsider))
          .status,
      ).toBe(404);
      expect((await get(`/b2b/requests/${request.id}`, viewer)).status).toBe(
        200,
      );
    });

    it("denies decisions and admin reads to authenticated staff without the approver grant", async () => {
      const request = await submit();
      expect((await get("/admin/approval-requests", staff)).status).toBe(403);
      expect(
        (await get(`/admin/approval-requests/${request.id}`, staff)).status,
      ).toBe(403);
      expect(
        (
          await post(
            `/admin/approval-requests/${request.id}/decision`,
            { decision: "approved", reason: "No permission" },
            staff,
          )
        ).status,
      ).toBe(403);
      expect(
        (await get(`/b2b/requests/${request.id}`, buyer)).data.approval_request
          .status,
      ).toBe("pending");
    });

    it("requires the correct authenticated actor and denies anonymous access", async () => {
      const request = await submit();
      expect(
        (await post("/b2b/requests", { cart_id: request.cart_id })).status,
      ).toBe(401);
      expect((await get(`/b2b/requests/${request.id}`)).status).toBe(401);
      expect((await get("/admin/approval-requests")).status).toBe(401);
      expect(
        (
          await post(
            `/admin/approval-requests/${request.id}/decision`,
            { decision: "approved", reason: "Buyer tries approval" },
            buyer,
          )
        ).status,
      ).toBe(401);
      expect((await get("/b2b/requests", manager)).status).toBe(401);
    });

    it("blocks a company member without submission permission", async () => {
      expect(
        (await post("/b2b/carts", { basket: "over-limit" }, viewer)).status,
      ).toBe(403);
      const c = await getContainer()
        .resolve(Modules.CART)
        .createCarts({
          customer_id: fixtures.viewer.id,
          currency_code: "pln",
          items: [{ title: "Kit", quantity: 3, unit_price: 450 }],
        });
      expect(
        (await post("/b2b/requests", { cart_id: c.id }, viewer)).status,
      ).toBe(403);
    });

    it("rejects company/amount spoofing and invalid decision bodies", async () => {
      const c = await cart();
      expect(
        (
          await post(
            "/b2b/requests",
            { cart_id: c.id, company_id: "company_other", amount_minor: 1 },
            buyer,
          )
        ).status,
      ).toBe(400);
      const response = await post("/b2b/requests", { cart_id: c.id }, buyer);
      expect(response.status).toBe(201);
      const path = `/admin/approval-requests/${response.data.approval_request.id}/decision`;
      for (const body of [
        { decision: "approved", reason: "   " },
        { decision: "pending", reason: "invalid" },
        { decision: "rejected", reason: "x".repeat(1001) },
        { decision: "approved", reason: "test", user_id: fixtures.staff.id },
      ]) {
        expect((await post(path, body, manager)).status).toBe(400);
      }
    });

    it("does not create requests below/equal to the limit or for empty/completed/foreign-currency carts", async () => {
      const c = await cart(buyer, "under-limit");
      expect(
        (await post("/b2b/requests", { cart_id: c.id }, buyer)).status,
      ).toBe(400);
      const carts = getContainer().resolve(Modules.CART);
      for (const data of [
        {
          currency_code: "pln",
          items: [{ title: "Exact limit", quantity: 1, unit_price: 1000 }],
        },
        { currency_code: "pln", items: [] },
        {
          currency_code: "eur",
          items: [{ title: "Wrong currency", quantity: 1, unit_price: 1500 }],
        },
        {
          currency_code: "pln",
          completed_at: new Date(),
          items: [{ title: "Completed", quantity: 1, unit_price: 1500 }],
        },
      ]) {
        const invalid = await carts.createCarts({
          ...data,
          customer_id: fixtures.buyer.id,
        });
        expect(
          (await post("/b2b/requests", { cart_id: invalid.id }, buyer)).status,
        ).toBe(400);
      }
    });

    it("allows exactly one submission per cart, including concurrent submissions", async () => {
      const c = await cart();
      const responses = await Promise.all([
        post("/b2b/requests", { cart_id: c.id }, buyer),
        post("/b2b/requests", { cart_id: c.id }, buyer),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(
        (await post("/b2b/requests", { cart_id: c.id }, buyer)).status,
      ).toBe(409);
    });

    it("keeps a snapshot when the open cart changes; approval never completes the cart", async () => {
      const request = await submit();
      const carts = getContainer().resolve(Modules.CART);
      const c = await carts.retrieveCart(request.cart_id, {
        relations: ["items"],
      });
      await carts.updateLineItems(c.items![0].id, { quantity: 10 });
      const changed = await carts.retrieveCart(request.cart_id, {
        relations: ["items"],
      });
      expect(changed.items![0].quantity).toBe(10);
      const response = await post(
        `/admin/approval-requests/${request.id}/decision`,
        { decision: "approved", reason: "Snapshot only" },
        manager,
      );
      expect(response.status).toBe(200);
      expect(response.data.approval_request.amount_minor).toBe(135000);
      expect(response.data.approval_request.snapshot.items[0].quantity).toBe(3);
      expect(
        (await carts.retrieveCart(request.cart_id)).completed_at,
      ).toBeNull();
    });
    it("persists the explicit Policy → Risk → Recommendation chain without auto-approval", async () => {
      const c = await cart(buyer, "clean");
      const created = await post("/b2b/requests", { cart_id: c.id }, buyer);
      const request = created.data.approval_request;
      const before = await get(
        `/admin/approval-requests/${request.id}`,
        manager,
      );
      expect(
        before.data.analysis_runs[0].steps.map((step: any) => step.status),
      ).toEqual(["waiting", "waiting", "waiting"]);
      expect(
        (
          await post(
            `/admin/approval-requests/${request.id}/decision`,
            { decision: "approved", reason: "Too early" },
            manager,
          )
        ).status,
      ).toBe(409);
      await processNextAnalysis(getContainer(), request.id);
      const response = await get(
        `/admin/approval-requests/${request.id}`,
        manager,
      );
      const run = response.data.analysis_runs[0];
      expect(run.status).toBe("completed");
      expect(run.recommendation).toBe("approve");
      expect(run.steps.map((step: any) => step.name)).toEqual([
        "policy",
        "risk",
        "recommendation",
      ]);
      expect(run.steps.every((step: any) => step.status === "completed")).toBe(
        true,
      );
      expect(run.steps[1].input.previous.policy).toEqual(run.steps[0].output);
      expect(run.steps[2].input.previous.risk).toEqual(run.steps[1].output);
      expect(run.steps[2].input.previous.policy).toEqual(run.steps[0].output);
      expect(run.steps[0].attempts[0]).toMatchObject({
        provider: "demo",
        model: "deterministic-demo-v1",
        input_tokens: null,
        status: "completed",
      });
      const payload = JSON.stringify(run.steps.map((step: any) => step.input));
      for (const privateValue of [
        fixtures.buyer.id,
        fixtures.buyer.email,
        "Acme Studio",
        request.cart_id,
        request.id,
      ])
        expect(payload).not.toContain(privateValue);
      expect(run.lease_token).toBeUndefined();
      expect(response.data.approval_request.status).toBe("pending");
      expect(response.data.approval_request.decided_at ?? null).toBeNull();
    });

    it("identifies high value with concrete evidence and requires manual review", async () => {
      const c = await cart(buyer, "manual");
      const response = await post("/b2b/requests", { cart_id: c.id }, buyer);
      await processNextAnalysis(
        getContainer(),
        response.data.approval_request.id,
      );
      const run = (
        await get(
          `/admin/approval-requests/${response.data.approval_request.id}`,
          manager,
        )
      ).data.analysis_runs[0];
      expect(run.input.facts.amount_minor).toBe(900000);
      expect(run.input.facts.warnings).toContain("HIGH_VALUE");
      expect(run.recommendation).toBe("manual_review");
      expect(run.steps[1].output.findings).toContainEqual(
        expect.objectContaining({
          code: "HIGH_VALUE",
          source_ids: ["cart.total", "policy.limit"],
        }),
      );
    });

    it("records a simulated outage, two attempts and blocked downstream stage; manual retry preserves history", async () => {
      const c = await cart(buyer, "failure");
      const request = (await post("/b2b/requests", { cart_id: c.id }, buyer))
        .data.approval_request;
      await processNextAnalysis(getContainer(), request.id);
      const failed = (
        await get(`/admin/approval-requests/${request.id}`, manager)
      ).data;
      expect(failed.approval_request).toMatchObject({
        status: "pending",
        analysis_status: "error",
        recommendation: "manual_review",
      });
      expect(
        failed.analysis_runs[0].steps.map((step: any) => step.status),
      ).toEqual(["completed", "error", "error"]);
      expect(
        failed.analysis_runs[0].steps[1].attempts.map(
          (attempt: any) => attempt.error_code,
        ),
      ).toEqual(["simulated_provider_error", "simulated_provider_error"]);
      expect(failed.analysis_runs[0].steps[2].error_code).toBe(
        "upstream_failed",
      );
      const path = `/admin/approval-requests/${request.id}/analysis/retry`;
      expect((await post(path, {}, staff)).status).toBe(403);
      expect((await post(path, {}, buyer)).status).toBe(401);
      const responses = await Promise.all([
        post(path, {}, manager),
        post(path, {}, manager),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([202, 409]);
      await processNextAnalysis(getContainer(), request.id);
      const recovered = (
        await get(`/admin/approval-requests/${request.id}`, manager)
      ).data;
      expect(recovered.analysis_runs).toHaveLength(2);
      expect(recovered.analysis_runs.map((run: any) => run.status)).toEqual([
        "completed",
        "error",
      ]);
      expect(recovered.analysis_runs[1].steps[1].attempts).toHaveLength(2);
      const decision = await post(
        `/admin/approval-requests/${request.id}/decision`,
        { decision: "approved", reason: "Reviewed recovered analysis" },
        manager,
      );
      expect(decision.status).toBe(200);
      expect(decision.data.approval_request.decision_run_id).toBe(
        recovered.analysis_runs[0].id,
      );
      expect((await post(path, {}, manager)).status).toBe(409);
    });

    it("allows an authorized human decision after agent failure without automatically approving", async () => {
      const c = await cart(buyer, "failure");
      const request = (await post("/b2b/requests", { cart_id: c.id }, buyer))
        .data.approval_request;
      await processNextAnalysis(getContainer(), request.id);
      expect(
        (await get(`/b2b/requests/${request.id}`, buyer)).data.approval_request
          .status,
      ).toBe("pending");
      expect(
        (
          await post(
            `/admin/approval-requests/${request.id}/decision`,
            {
              decision: "approved",
              reason: "Independently verified supplier and budget",
            },
            manager,
          )
        ).status,
      ).toBe(200);
    });

    it("retries a transient agent error once and records both attempts", async () => {
      const c = await cart();
      const request = (await post("/b2b/requests", { cart_id: c.id }, buyer))
        .data.approval_request;
      const demo = new DemoProvider();
      const provider: AgentProvider = {
        call: async (input, context, signal) => {
          if (input.agent === "risk" && context.attempt === 1)
            throw new AgentFailure("rate_limited");
          return demo.call(input, context, signal);
        },
      };
      await processNextAnalysis(getContainer(), request.id, provider);
      const run = (await get(`/admin/approval-requests/${request.id}`, manager))
        .data.analysis_runs[0];
      expect(run.status).toBe("completed");
      expect(
        run.steps[1].attempts.map((attempt: any) => attempt.status),
      ).toEqual(["error", "completed"]);
      expect(run.steps[1].attempts[0].error_code).toBe("rate_limited");
    });

    it("rejects invalid model output before it reaches the next agent", async () => {
      const c = await cart();
      const request = (await post("/b2b/requests", { cart_id: c.id }, buyer))
        .data.approval_request;
      const calls: string[] = [];
      const invalid: AgentProvider = {
        call: async (input) => {
          calls.push(input.agent);
          return {
            output: { approve: true, secret: "must-not-be-persisted" },
            model: "test-invalid",
            input_tokens: 12,
            output_tokens: 5,
          };
        },
      };
      await processNextAnalysis(getContainer(), request.id, invalid);
      const run = (await get(`/admin/approval-requests/${request.id}`, manager))
        .data.analysis_runs[0];
      expect(calls).toEqual(["policy", "policy"]);
      expect(run.status).toBe("error");
      expect(run.recommendation).toBe("manual_review");
      expect(run.steps[0].attempts[0]).toMatchObject({
        error_code: "invalid_response",
        input_tokens: 12,
        output_tokens: 5,
        output: null,
      });
      expect(JSON.stringify(run)).not.toContain("must-not-be-persisted");
    });

    it("times out a stuck provider, bounds retries and routes the request to human review", async () => {
      const c = await cart();
      const request = (await post("/b2b/requests", { cart_id: c.id }, buyer))
        .data.approval_request;
      const oldTimeout = process.env.AGENT_TIMEOUT_MS;
      process.env.AGENT_TIMEOUT_MS = "50";
      try {
        await processNextAnalysis(getContainer(), request.id, {
          call: () => new Promise(() => {}),
        });
      } finally {
        if (oldTimeout === undefined) delete process.env.AGENT_TIMEOUT_MS;
        else process.env.AGENT_TIMEOUT_MS = oldTimeout;
      }
      const run = (await get(`/admin/approval-requests/${request.id}`, manager))
        .data.analysis_runs[0];
      expect(run.status).toBe("error");
      expect(
        run.steps[0].attempts.map((attempt: any) => attempt.error_code),
      ).toEqual(["timeout", "timeout"]);
      expect(run.recommendation).toBe("manual_review");
    });

    it("enforces category/data blockers even if every agent recommends approve", async () => {
      const c = await cart();
      const service =
        getContainer().resolve<ApprovalModuleService>(APPROVAL_MODULE);
      const [context] = await service.listPurchaseContexts({ cart_id: c.id });
      await service.updatePurchaseContexts({
        id: context.id,
        data: {
          category_ids: ["restricted"],
          cost_center: null,
          purpose: "Supplies",
          purchase_ref: "blocked-test",
        },
      });
      const request = (await post("/b2b/requests", { cart_id: c.id }, buyer))
        .data.approval_request;
      const optimistic: AgentProvider = {
        call: async (input) => ({
          model: "test-optimistic",
          input_tokens: 1,
          output_tokens: 1,
          output: {
            schema_version: "1",
            agent: input.agent,
            recommendation: "approve",
            rationale: "Approve everything",
            findings: [
              {
                code: "OK",
                severity: "info",
                explanation: "Optimistic model",
                source_ids: ["cart.total"],
              },
            ],
            uncertainty: [],
          },
        }),
      };
      await processNextAnalysis(getContainer(), request.id, optimistic);
      const result = (
        await get(`/admin/approval-requests/${request.id}`, manager)
      ).data;
      expect(result.analysis_runs[0].guardrails).toMatchObject({
        suggested: null,
        recommendation: "manual_review",
      });
      expect(result.analysis_runs[0].steps[0].output).toBeNull();
      expect(
        result.analysis_runs[0].steps[0].attempts.map((a: any) => a.error_code),
      ).toEqual(["recommendation_conflict", "recommendation_conflict"]);
      expect(result.analysis_runs[0].steps[1].attempts).toHaveLength(0);
      expect(result.analysis_runs[0].input.facts.blockers).toEqual([
        "CATEGORY_NOT_ALLOWED",
        "REQUIRED_DATA_MISSING",
      ]);
      expect(
        (
          await post(
            `/admin/approval-requests/${request.id}/decision`,
            { decision: "approved", reason: "Ignore policy" },
            manager,
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await post(
            `/admin/approval-requests/${request.id}/decision`,
            {
              decision: "rejected",
              reason: "Missing required data and restricted category",
            },
            manager,
          )
        ).status,
      ).toBe(200);
    });

    it("detects another cart using the same company purchase reference", async () => {
      const first = await cart();
      const second = await cart();
      const service =
        getContainer().resolve<ApprovalModuleService>(APPROVAL_MODULE);
      const [original] = await service.listPurchaseContexts({
        cart_id: first.id,
      });
      const [other] = await service.listPurchaseContexts({
        cart_id: second.id,
      });
      await service.updatePurchaseContexts({
        id: other.id,
        data: original.data,
      });
      expect(
        (await post("/b2b/requests", { cart_id: first.id }, buyer)).status,
      ).toBe(201);
      const request = (
        await post("/b2b/requests", { cart_id: second.id }, buyer)
      ).data.approval_request;
      await processNextAnalysis(getContainer(), request.id);
      const run = (await get(`/admin/approval-requests/${request.id}`, manager))
        .data.analysis_runs[0];
      expect(run.input.facts.duplicate_count).toBe(1);
      expect(run.recommendation).toBe("manual_review");
      expect(run.steps[1].output.findings).toContainEqual(
        expect.objectContaining({
          code: "POSSIBLE_DUPLICATE",
          source_ids: ["history.duplicates"],
        }),
      );
    });

    it("claims work once, recovers an interrupted attempt and fences out a stale worker", async () => {
      const c = await cart();
      const request = (await post("/b2b/requests", { cart_id: c.id }, buyer))
        .data.approval_request;
      const service =
        getContainer().resolve<ApprovalModuleService>(APPROVAL_MODULE);
      const claims = await Promise.all([
        service.claimAnalysis(request.id),
        service.claimAnalysis(request.id),
      ]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      const claim = claims.find(Boolean)!;
      const run = await service.retrieveAnalysisRun(claim.id);
      const attempt = await service.beginAgentAttempt(
        claim.id,
        claim.lease_token,
        "policy",
        {
          schema_version: "1",
          agent: "policy",
          facts: (run.input as any).facts,
          previous: {},
        },
      );
      const connection = getContainer().resolve(
        ContainerRegistrationKeys.PG_CONNECTION,
      );
      await connection.raw(
        "UPDATE approval_analysis_run SET lease_until = now() - interval '1 second' WHERE id = ?",
        [claim.id],
      );
      await processNextAnalysis(getContainer(), request.id);
      await expect(
        service.finishAgentAttempt(claim.id, claim.lease_token, attempt!.id, {
          error_code: "timeout",
          duration_ms: 1,
        }),
      ).rejects.toThrow("Analysis lease lost");
      const recovered = (
        await get(`/admin/approval-requests/${request.id}`, manager)
      ).data.analysis_runs[0];
      expect(recovered.status).toBe("completed");
      expect(recovered.steps[0].attempts.map((a: any) => a.status)).toEqual([
        "error",
        "completed",
      ]);
      expect(recovered.steps[0].attempts[0].error_code).toBe(
        "worker_interrupted",
      );
    });

    it("caps paid or simulated retries at three runs", async () => {
      const c = await cart();
      const request = (await post("/b2b/requests", { cart_id: c.id }, buyer))
        .data.approval_request;
      const failing: AgentProvider = {
        call: async () => {
          throw new AgentFailure("provider_error");
        },
      };
      for (let sequence = 1; sequence <= 3; sequence++) {
        await processNextAnalysis(getContainer(), request.id, failing);
        const retry = await post(
          `/admin/approval-requests/${request.id}/analysis/retry`,
          {},
          manager,
        );
        expect(retry.status).toBe(sequence < 3 ? 202 : 400);
      }
      expect(
        (await get(`/admin/approval-requests/${request.id}`, manager)).data
          .analysis_runs,
      ).toHaveLength(3);
      const audit = (
        await get(`/admin/approval-requests/${request.id}`, manager)
      ).data;
      expect(audit.analysis_runs[0].violations).toContainEqual(
        expect.objectContaining({
          code: "run_limit_exceeded",
          phase: "budget",
        }),
      );
      expect(audit.approval_request.recommendation).toBe("manual_review");
    });

    it("contains product prompt injection, records rejected outputs and never decides a purchase", async () => {
      const c = await cart(buyer, "injection");
      expect(c.items[0].product_description).toBe(INJECTION_DESCRIPTION);
      const request = (await post("/b2b/requests", { cart_id: c.id }, buyer))
        .data.approval_request;
      await processNextAnalysis(getContainer(), request.id);
      const result = (
        await get(`/admin/approval-requests/${request.id}`, manager)
      ).data;
      const run = result.analysis_runs[0];
      expect(result.approval_request).toMatchObject({
        status: "pending",
        amount_minor: 135000,
        limit_minor: 100000,
        recommendation: "manual_review",
      });
      expect(result.approval_request.decided_by).toBeFalsy();
      expect(result.agent_budget).toMatchObject({ used: 2, limit: 8 });
      expect(run.input.facts.untrusted_product_descriptions[0].text).toBe(
        INJECTION_DESCRIPTION,
      );
      expect(
        run.steps[0].input.facts.untrusted_product_descriptions[0].text,
      ).toBe(INJECTION_DESCRIPTION);
      expect(run.input.facts.allowed_categories).toContain("office_supplies");
      expect(run.input.facts.warnings).toContain("UNTRUSTED_INSTRUCTION");
      expect(run.violations.map((v: any) => v.code)).toEqual([
        "untrusted_instruction",
        "recommendation_conflict",
        "recommendation_conflict",
      ]);
      expect(run.steps[0].output).toBeNull();
      expect(run.steps[0].attempts.every((a: any) => a.output === null)).toBe(
        true,
      );
      expect(
        run.steps.slice(1).every((step: any) => step.attempts.length === 0),
      ).toBe(true);
      // A model cannot smuggle a decision through the response or use customer privileges.
      expect(
        (
          await post(
            `/admin/approval-requests/${request.id}/decision`,
            { decision: "approved", reason: INJECTION_DESCRIPTION },
            buyer,
          )
        ).status,
      ).toBe(401);
      expect(
        (await get(`/b2b/requests/${request.id}`, buyer)).data.approval_request
          .status,
      ).toBe("pending");
    });

    it.each([
      "identity",
      "revoked",
      "other_company",
      "owner",
      "total",
      "currency",
      "completed",
    ])("revalidates %s before any provider invocation", async (kind) => {
      const c = await cart();
      const request = (await post("/b2b/requests", { cart_id: c.id }, buyer))
        .data.approval_request;
      const service =
        getContainer().resolve<ApprovalModuleService>(APPROVAL_MODULE);
      if (kind === "identity") {
        const customers = getContainer().resolve(Modules.CUSTOMER);
        await customers.softDeleteCustomers([fixtures.buyer.id]);
        expect(
          await customers.listCustomers({ id: fixtures.buyer.id }),
        ).toHaveLength(0);
      }
      if (["revoked", "other_company"].includes(kind)) {
        const [member] = await service.listMembers({
          customer_id: fixtures.buyer.id,
        });
        await service.updateMembers({
          id: member.id,
          ...(kind === "revoked"
            ? { can_submit: false }
            : { company_id: "company_other" }),
        });
      }
      const carts = getContainer().resolve(Modules.CART);
      if (kind === "owner")
        await carts.updateCarts(c.id, { customer_id: fixtures.outsider.id });
      if (kind === "currency")
        await carts.updateCarts(c.id, { currency_code: "eur" });
      if (kind === "completed")
        await carts.updateCarts(c.id, { completed_at: new Date() });
      if (kind === "total") {
        await carts.updateLineItems({ id: c.items[0].id }, { quantity: 10 });
        const changed = await carts.retrieveCart(c.id, {
          relations: ["items"],
        });
        expect(Number(changed.items![0].quantity)).toBe(10);
      }
      const call = jest.fn();
      await processNextAnalysis(getContainer(), request.id, { call });
      expect(call).not.toHaveBeenCalled();
      const result = (
        await get(`/admin/approval-requests/${request.id}`, manager)
      ).data;
      const code =
        kind === "identity"
          ? "identity_invalid"
          : ["revoked", "other_company"].includes(kind)
            ? "company_access_denied"
            : "cart_invalid";
      expect(result.agent_budget.used).toBe(0);
      expect(result.analysis_runs[0].violations).toContainEqual(
        expect.objectContaining({ code, phase: "input" }),
      );
      expect(result.approval_request).toMatchObject({
        status: "pending",
        recommendation: "manual_review",
        analysis_status: "error",
      });
      expect(
        (
          await post(
            `/admin/approval-requests/${request.id}/decision`,
            { decision: "approved", reason: "Cannot bypass invalid inputs" },
            manager,
          )
        ).status,
      ).toBe(403);
    });

    it("rechecks authorization between retry attempts", async () => {
      const c = await cart();
      const request = (await post("/b2b/requests", { cart_id: c.id }, buyer))
        .data.approval_request;
      const service =
        getContainer().resolve<ApprovalModuleService>(APPROVAL_MODULE);
      const call = jest.fn(async () => {
        const [member] = await service.listMembers({
          customer_id: fixtures.buyer.id,
        });
        await service.updateMembers({ id: member.id, can_submit: false });
        throw new AgentFailure("provider_error");
      });
      await processNextAnalysis(getContainer(), request.id, { call });
      expect(call).toHaveBeenCalledTimes(1);
      const run = (await get(`/admin/approval-requests/${request.id}`, manager))
        .data.analysis_runs[0];
      expect(run.violations.map((v: any) => v.code)).toEqual([
        "provider_error",
        "company_access_denied",
      ]);
      expect(run.recommendation).toBe("manual_review");
    });

    it("caps calls across runs at eight and persists budget exhaustion before another provider call", async () => {
      const c = await cart();
      const request = (await post("/b2b/requests", { cart_id: c.id }, buyer))
        .data.approval_request;
      const demo = new DemoProvider();
      const call = jest.fn(async (input, context, signal) => {
        if (
          (context.run_sequence === 1 && input.agent === "recommendation") ||
          (context.run_sequence === 2 && input.agent === "risk")
        )
          throw new AgentFailure("provider_error");
        return demo.call(input, context, signal);
      });
      for (let sequence = 1; sequence <= 3; sequence++) {
        if (sequence > 1)
          expect(
            (
              await post(
                `/admin/approval-requests/${request.id}/analysis/retry`,
                {},
                manager,
              )
            ).status,
          ).toBe(202);
        await processNextAnalysis(getContainer(), request.id, { call });
      }
      expect(call).toHaveBeenCalledTimes(8);
      const result = (
        await get(`/admin/approval-requests/${request.id}`, manager)
      ).data;
      expect(result.agent_budget).toMatchObject({ used: 8, limit: 8 });
      expect(result.approval_request).toMatchObject({
        status: "pending",
        recommendation: "manual_review",
      });
      expect(result.analysis_runs[0].steps[1]).toMatchObject({
        status: "error",
        error_code: "call_limit_exceeded",
        attempts: [],
      });
      expect(result.analysis_runs[0].violations).toContainEqual(
        expect.objectContaining({
          code: "call_limit_exceeded",
          phase: "budget",
        }),
      );
      expect(
        (
          await post(
            `/admin/approval-requests/${request.id}/analysis/retry`,
            {},
            manager,
          )
        ).status,
      ).toBe(400);
      expect(
        await processNextAnalysis(getContainer(), request.id, { call }),
      ).toBe(false);
      expect(call).toHaveBeenCalledTimes(8);
    });

    it.each(["risk", "recommendation"])(
      "validates the %s output before forwarding or finalizing",
      async (target) => {
        const c = await cart();
        const request = (await post("/b2b/requests", { cart_id: c.id }, buyer))
          .data.approval_request;
        const demo = new DemoProvider();
        await processNextAnalysis(getContainer(), request.id, {
          call: async (input, context, signal) => {
            const result = await demo.call(input, context, signal);
            return input.agent === target
              ? {
                  ...result,
                  output: {
                    ...(result.output as object),
                    rationale: " ",
                    final_decision: "approved",
                  },
                }
              : result;
          },
        });
        const result = (
          await get(`/admin/approval-requests/${request.id}`, manager)
        ).data;
        const step = result.analysis_runs[0].steps.find(
          (s: any) => s.name === target,
        );
        expect(step.attempts).toHaveLength(2);
        expect(step.output).toBeNull();
        expect(
          result.analysis_runs[0].violations.filter(
            (v: any) => v.code === "invalid_response",
          ),
        ).toHaveLength(2);
        expect(result.approval_request).toMatchObject({
          status: "pending",
          recommendation: "manual_review",
        });
        expect(result.approval_request.decided_at).toBeFalsy();
      },
    );
  },
});
