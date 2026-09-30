import { model } from "@medusajs/framework/utils";

export const PurchaseContext = model.define("approval_purchase_context", {
  id: model.id({ prefix: "purchase_context" }).primaryKey(),
  cart_id: model.text().unique(),
  scenario: model
    .enum(["clean", "manual", "failure", "injection"])
    .default("clean"),
  data: model.json(),
});

export const AnalysisRun = model.define("approval_analysis_run", {
  id: model.id({ prefix: "analysis" }).primaryKey(),
  request_id: model.text(),
  sequence: model.number(),
  provider: model.enum(["demo", "openai"]),
  model: model.text(),
  prompt_version: model.text().default("b2b-v1"),
  status: model
    .enum(["waiting", "running", "completed", "error"])
    .default("waiting"),
  input: model.json(),
  recommendation: model.enum(["approve", "reject", "manual_review"]).nullable(),
  summary: model.text().nullable(),
  guardrails: model.json().nullable(),
  started_at: model.dateTime().nullable(),
  finished_at: model.dateTime().nullable(),
  lease_token: model.text().nullable(),
  lease_until: model.dateTime().nullable(),
});

export const AgentStep = model.define("approval_agent_step", {
  id: model.id({ prefix: "agent_step" }).primaryKey(),
  run_id: model.text(),
  name: model.enum(["policy", "risk", "recommendation"]),
  position: model.number(),
  status: model
    .enum(["waiting", "running", "completed", "error"])
    .default("waiting"),
  input: model.json().nullable(),
  output: model.json().nullable(),
  error_code: model.text().nullable(),
  started_at: model.dateTime().nullable(),
  finished_at: model.dateTime().nullable(),
});

export const AgentAttempt = model.define("approval_agent_attempt", {
  id: model.id({ prefix: "attempt" }).primaryKey(),
  run_id: model.text(),
  step_id: model.text(),
  number: model.number(),
  status: model.enum(["running", "completed", "error"]),
  provider: model.text(),
  model: model.text(),
  started_at: model.dateTime(),
  finished_at: model.dateTime().nullable(),
  duration_ms: model.number().nullable(),
  input_tokens: model.number().nullable(),
  output_tokens: model.number().nullable(),
  error_code: model.text().nullable(),
  output: model.json().nullable(),
});

export const GuardrailViolation = model.define("approval_guardrail_violation", {
  id: model.id({ prefix: "violation" }).primaryKey(),
  request_id: model.text(),
  run_id: model.text(),
  step_id: model.text().nullable(),
  attempt_id: model.text().nullable(),
  phase: model.enum(["input", "output", "budget", "execution"]),
  code: model.text(),
  detail: model.text(),
});
