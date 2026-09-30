import { GuardrailError } from "./guardrails";
import { z } from "@medusajs/framework/zod";

export const AGENTS = ["policy", "risk", "recommendation"] as const;
export type AgentName = (typeof AGENTS)[number];
export type Recommendation = "approve" | "reject" | "manual_review";
export type Source = { id: string; label: string; value: string };
export type Facts = {
  amount_minor: number;
  currency_code: string;
  limit_minor: number;
  categories: string[];
  allowed_categories: string[];
  required_data_present: boolean;
  purpose: string;
  untrusted_product_descriptions: { source_id: string; text: string }[];
  duplicate_count: number;
  high_value: boolean;
  blockers: string[];
  warnings: string[];
  sources: Source[];
  policy: string;
};
export type AgentInput = {
  schema_version: "1";
  agent: AgentName;
  facts: Facts;
  previous: Partial<Record<AgentName, AgentOutput>>;
};
const OutputSchema = z
  .object({
    schema_version: z.literal("1"),
    agent: z.enum(AGENTS),
    recommendation: z.enum(["approve", "reject", "manual_review"]),
    rationale: z.string().trim().min(1).max(900),
    findings: z
      .array(
        z
          .object({
            code: z.string().min(1).max(60),
            severity: z.enum(["info", "attention", "block"]),
            explanation: z.string().trim().min(1).max(500),
            source_ids: z.array(z.string().min(1).max(50)).min(1).max(8),
          })
          .strict(),
      )
      .min(1)
      .max(8),
    uncertainty: z.array(z.string().min(1).max(300)).max(5),
  })
  .strict();
export type AgentOutput = z.infer<typeof OutputSchema>;

export function validateOutput(raw: unknown, input: AgentInput): AgentOutput {
  const output = OutputSchema.parse(raw);
  if (output.agent !== input.agent) throw new Error("Wrong agent");
  const knownSources = new Set(input.facts.sources.map((source) => source.id));
  if (
    output.findings.some((finding) =>
      finding.source_ids.some((id) => !knownSources.has(id)),
    )
  )
    throw new Error("Unknown source reference");
  const upstreamAttention = Object.values(input.previous).some(
    (previous) =>
      previous &&
      (previous.recommendation !== "approve" ||
        previous.uncertainty.length ||
        previous.findings.some((finding) => finding.severity !== "info")),
  );
  if (
    output.recommendation === "approve" &&
    (input.facts.blockers.length ||
      input.facts.warnings.length ||
      upstreamAttention ||
      output.uncertainty.length ||
      output.findings.some((finding) => finding.severity !== "info"))
  )
    throw new GuardrailError("recommendation_conflict");
  return output;
}

// The remote schema and local Zod validation cover the same structure. Local validation
// additionally checks limits, agent identity and source provenance, even for demo output.
export function outputJsonSchema(agent: AgentName) {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "schema_version",
      "agent",
      "recommendation",
      "rationale",
      "findings",
      "uncertainty",
    ],
    properties: {
      schema_version: { type: "string", enum: ["1"] },
      agent: { type: "string", enum: [agent] },
      recommendation: {
        type: "string",
        enum: ["approve", "reject", "manual_review"],
      },
      rationale: { type: "string" },
      findings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["code", "severity", "explanation", "source_ids"],
          properties: {
            code: { type: "string" },
            severity: { type: "string", enum: ["info", "attention", "block"] },
            explanation: { type: "string" },
            source_ids: { type: "array", items: { type: "string" } },
          },
        },
      },
      uncertainty: { type: "array", items: { type: "string" } },
    },
  };
}
