import { Badge, Heading, Text } from "@medusajs/ui";

export type AnalysisRun = {
  id: string;
  sequence: number;
  provider: "demo" | "openai";
  model: string;
  prompt_version: string;
  status: string;
  recommendation: string | null;
  summary: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  guardrails: { suggested: string | null; reasons: string[] } | null;
  input: {
    facts: {
      blockers: string[];
      warnings: string[];
      sources: { id: string; label: string; value: string }[];
      untrusted_product_descriptions?: { source_id: string; text: string }[];
    };
  };
  violations?: { id: string; phase: string; code: string; detail: string; created_at: string; step_id: string | null; attempt_id: string | null }[];
  steps: {
    id: string;
    name: string;
    position: number;
    status: string;
    input: unknown;
    output: {
      recommendation: string;
      rationale: string;
      uncertainty: string[];
      findings: {
        code: string;
        severity: string;
        explanation: string;
        source_ids: string[];
      }[];
    } | null;
    error_code: string | null;
    attempts: {
      id: string;
      number: number;
      status: string;
      model: string;
      provider: string;
      duration_ms: number | null;
      input_tokens: number | null;
      output_tokens: number | null;
      error_code: string | null;
      started_at: string;
      finished_at: string | null;
    }[];
  }[];
};
export const StateBadge = ({ status }: { status: string }) => (
  <Badge
    color={
      ["completed", "approved", "approve"].includes(status)
        ? "green"
        : ["error", "rejected", "reject"].includes(status)
          ? "red"
          : ["waiting", "pending"].includes(status)
            ? "grey"
            : "orange"
    }
  >
    {status.replaceAll("_", " ")}
  </Badge>
);
const agentNames: Record<string, string> = {
  policy: "Policy Agent",
  risk: "Risk Agent",
  recommendation: "Recommendation Agent",
};
const errorDescriptions: Record<string, string> = {
  simulated_provider_error:
    "Simulated provider outage. No external API was called.",
  recommendation_conflict: "Code rejected the recommendation: it conflicts with mandatory rules or requires review.",
  call_limit_exceeded: "Request-wide call budget exhausted. No provider call was made.",
  company_access_denied: "Company access check failed before the provider call.",
  identity_invalid: "Customer identity check failed before the provider call.",
  cart_invalid: "Cart validation failed before the provider call.",
  preflight_unavailable: "Input validation could not complete. No provider call was made.",
  timeout: "The provider exceeded the time limit. The attempt was cancelled.",
  invalid_response:
    "The response failed schema or source validation and was discarded.",
  upstream_failed: "Not executed because a required upstream agent failed.",
  worker_interrupted:
    "Worker interrupted; the durable attempt was recovered after its lease expired.",
  provider_error: "The provider could not complete the request.",
  rate_limited: "The provider rate-limited this attempt.",
  configuration_error: "The provider key is not configured.",
  refused: "The model refused the request.",
  incomplete_response: "The provider returned an incomplete response.",
};
export const AnalysisTimeline = ({ run }: { run: AnalysisRun }) => {
  const attempts = run.steps.flatMap((step) => step.attempts);
  const usageAvailable = attempts.some(
    (attempt) => attempt.input_tokens != null,
  );
  const usageIncomplete = attempts.some(
    (attempt) => attempt.input_tokens == null,
  );
  const inputTokens = attempts.reduce(
    (total, attempt) => total + (attempt.input_tokens || 0),
    0,
  );
  const outputTokens = attempts.reduce(
    (total, attempt) => total + (attempt.output_tokens || 0),
    0,
  );
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-lg border bg-ui-bg-subtle p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Heading level="h3">
            Run #{run.sequence} ·{" "}
            {run.provider === "demo" ? "DEMO / SIMULATED" : "LIVE / OpenAI"}
          </Heading>
          <StateBadge status={run.status} />
        </div>
        <Text size="small" className="mt-2 text-ui-fg-subtle">
          {run.provider === "demo"
            ? "Deterministic responses. No model API calls or token charges."
            : "Real model calls. The model has no tools or decision permissions."}
        </Text>
        <Text size="small" className="mt-2">
          Model: {run.model} · Prompt: {run.prompt_version}
        </Text>
        <Text size="small" className="text-ui-fg-subtle">
          {run.started_at
            ? new Date(run.started_at).toLocaleString("en-GB")
            : "Waiting for the background worker"}
          {run.finished_at && run.started_at
            ? ` · ${((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000).toFixed(1)}s elapsed`
            : ""}{" "}
          ·{" "}
          {run.provider === "demo"
            ? "Tokens: not applicable"
            : !usageAvailable
              ? "Token usage unavailable"
              : `Reported tokens: ${inputTokens} input / ${outputTokens} output${usageIncomplete ? " (partial; some attempts have no usage)" : ""}`}
        </Text>
      </div>
      {!!run.input.facts.untrusted_product_descriptions?.length && <section className="rounded-lg border p-4" aria-label="Untrusted product content">
        <Heading level="h3">Product descriptions · untrusted data</Heading>
        <p className="mt-2 text-sm text-ui-fg-subtle">Agents may read this text. It cannot change company rules, permissions, call limits or the final human decision.</p>
        {run.input.facts.untrusted_product_descriptions.map(item => <blockquote key={item.source_id} className="mt-3 border-l-2 pl-3 text-sm"><p className="whitespace-pre-wrap">{item.text}</p><p className="text-xs text-ui-fg-muted">Source: {item.source_id}</p></blockquote>)}
        {run.provider === "demo" && run.input.facts.warnings.includes("UNTRUSTED_INSTRUCTION") && <p className="mt-3 text-sm">Adversarial DEMO: the simulated model follows the product instruction. The output guard rejects its recommendation before it can reach another agent.</p>}
      </section>}
      <section className="rounded-lg border p-4" aria-label="Guardrail violations">
        <Heading level="h3">Guardrail history</Heading>
        <p className="mt-2 text-sm text-ui-fg-subtle">Enforced by code. Invalid responses are discarded; failures require manual review.</p>
        {!run.violations?.length ? <p className="mt-2 text-sm">No recorded violations.</p> : <ol className="mt-3 flex flex-col gap-3">{run.violations.map(violation => <li key={violation.id} className="rounded bg-ui-bg-subtle p-3 text-sm"><p className="font-medium">{violation.code} · {violation.phase}</p><p>{violation.detail}</p><p className="mt-1 break-all text-xs text-ui-fg-muted">{new Date(violation.created_at).toLocaleString("en-GB")}{violation.attempt_id ? ` · Attempt: ${violation.attempt_id}` : " · Before provider call"}</p></li>)}</ol>}
      </section>
      {run.recommendation && (
        <div className="rounded-lg border p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Heading level="h3">Advisory recommendation</Heading>
            <StateBadge status={run.recommendation} />
          </div>
          <p className="mt-2 text-sm">{run.summary}</p>
          {run.guardrails?.reasons.length ? (
            <p className="mt-2 text-sm text-ui-fg-subtle">
              Code-enforced flags: {run.guardrails.reasons.join(", ")}. Model
              suggestion: {run.guardrails.suggested || "unavailable"}.
            </p>
          ) : null}
          <p className="mt-2 text-sm font-medium">
            A recommendation never approves a purchase. The final human decision
            is shown below.
          </p>
        </div>
      )}
      <ol className="flex flex-col gap-4" aria-label="Agent execution timeline">
        {run.steps.map((step) => (
          <li key={step.id} className="rounded-lg border p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ui-bg-subtle text-sm font-medium">
                  {step.position}
                </span>
                <Heading level="h3">{agentNames[step.name]}</Heading>
              </div>
              <StateBadge status={step.status} />
            </div>
            <Text size="small" className="mt-2 text-ui-fg-muted">
              {step.name === "policy"
                ? "Input: immutable purchase facts + company policy"
                : step.name === "risk"
                  ? "Input: purchase facts + validated Policy result"
                  : "Input: purchase facts + validated Policy and Risk results"}
            </Text>
            {step.status === "waiting" && (
              <p className="mt-3 text-sm text-ui-fg-subtle">
                Waiting for its turn.
              </p>
            )}
            {step.status === "running" && (
              <p role="status" className="mt-3 text-sm">
                Analyzing… only validated output will be used.
              </p>
            )}
            {step.error_code && (
              <p className="mt-3 rounded-md bg-ui-bg-subtle p-3 text-sm">
                {errorDescriptions[step.error_code] || step.error_code}
              </p>
            )}
            {step.output && (
              <div className="mt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <StateBadge status={step.output.recommendation} />
                  <p className="text-sm">{step.output.rationale}</p>
                </div>
                <ul className="mt-3 flex flex-col gap-3">
                  {step.output.findings.map((finding, i) => (
                    <li key={i} className="rounded-md bg-ui-bg-subtle p-3">
                      <p className="text-xs font-medium">
                        {finding.code} · {finding.severity}
                      </p>
                      <p className="mt-1 text-sm">{finding.explanation}</p>
                      <p className="mt-1 break-words text-xs text-ui-fg-muted">
                        Sources: {finding.source_ids.join(" · ")}
                      </p>
                    </li>
                  ))}
                </ul>
                {step.output.uncertainty.length > 0 && (
                  <div className="mt-3 text-sm">
                    <strong>Uncertainty</strong>
                    <ul className="ml-5 list-disc">
                      {step.output.uncertainty.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
            {step.attempts.length > 0 && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium">
                  Attempt history ({step.attempts.length}/2)
                </summary>
                <ul className="mt-2 flex flex-col gap-2">
                  {step.attempts.map((attempt) => (
                    <li key={attempt.id} className="rounded border p-3 text-xs">
                      <p>
                        Attempt {attempt.number} · {attempt.status} ·{" "}
                        {attempt.duration_ms == null
                          ? "in progress"
                          : `${attempt.duration_ms} ms`}
                      </p>
                      <p className="mt-1">
                        {attempt.model} ·{" "}
                        {attempt.input_tokens == null
                          ? "token usage unavailable / not applicable"
                          : `${attempt.input_tokens} input + ${attempt.output_tokens} output tokens`}
                      </p>
                      <p className="mt-1">
                        {new Date(attempt.started_at).toLocaleString("en-GB")}
                        {attempt.error_code ? ` · ${attempt.error_code}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {step.input != null && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm">
                  Validated input contract
                </summary>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-ui-bg-subtle p-3 text-xs">
                  {JSON.stringify(step.input, null, 2)}
                </pre>
              </details>
            )}
          </li>
        ))}
      </ol>
      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Source facts & deterministic checks
        </summary>
        <p className="mt-2 text-xs text-ui-fg-muted">
          No customer name, email, address, user ID or company name is sent to
          the model.
        </p>
        <dl className="mt-3 grid gap-3">
          {run.input.facts.sources.map((source) => (
            <div key={source.id}>
              <dt className="text-xs font-medium">
                {source.label} · {source.id}
              </dt>
              <dd className="mt-1 text-sm">{source.value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-sm">
          Approval blockers: {run.input.facts.blockers.join(", ") || "none"}
        </p>
        <p className="text-sm">
          Attention flags: {run.input.facts.warnings.join(", ") || "none"}
        </p>
      </details>
    </div>
  );
};
