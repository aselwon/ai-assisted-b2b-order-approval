import { instructionLike, minimizeText } from "./guardrails";
import { Facts, Recommendation } from "./contracts";

export const DEFAULT_POLICY = {
  version: "purchasing-v1",
  allowed_categories: ["office_supplies", "it_equipment"],
  required_data: ["cost_center", "purpose"],
  text: "Routine office supplies and IT equipment are permitted with a cost center and business purpose. Above-limit purchases always require human approval. Unplanned expansion requires budget confirmation. Purchases above five times the approval limit require manual investigation.",
};

export function buildFacts(request: any, duplicateCount: number): Facts {
  const snapshot = request.snapshot;
  const context = snapshot.purchase_context || {};
  const policy = snapshot.policy || DEFAULT_POLICY;
  const categories: string[] = Array.isArray(context.category_ids)
    ? context.category_ids
    : ["unclassified"];
  const requiredPresent =
    typeof context.cost_center === "string" &&
    Boolean(context.cost_center.trim()) &&
    typeof context.purpose === "string" &&
    Boolean(context.purpose.trim());
  // Allowlist only the bounded product text, never arbitrary metadata/PII/IDs.
  const descriptions = (snapshot.items || [])
    .slice(0, 20)
    .map((item: any, index: number) => ({
      source_id: `product.${index}.description`,
      text: minimizeText(item.product_description),
    }))
    .filter((entry: any) => entry.text);
  const highValue = request.amount_minor > request.limit_minor * 5;
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (
    !categories.length ||
    categories.some((category) => !policy.allowed_categories.includes(category))
  )
    blockers.push("CATEGORY_NOT_ALLOWED");
  if (!requiredPresent) blockers.push("REQUIRED_DATA_MISSING");
  if (
    descriptions.some((entry: any) => instructionLike(entry.text)) ||
    instructionLike(String(context.purpose || ""))
  )
    warnings.push("UNTRUSTED_INSTRUCTION");
  if (highValue) warnings.push("HIGH_VALUE");
  if (duplicateCount > 0) warnings.push("DUPLICATE_PURCHASE_REFERENCE");
  return {
    amount_minor: request.amount_minor,
    currency_code: request.currency_code,
    limit_minor: request.limit_minor,
    categories,
    allowed_categories: policy.allowed_categories,
    required_data_present: requiredPresent,
    purpose: minimizeText(context.purpose || "Not supplied"),
    untrusted_product_descriptions: descriptions,
    duplicate_count: duplicateCount,
    high_value: highValue,
    blockers,
    warnings,
    policy: policy.text,
    sources: [
      ...descriptions.map((entry: any) => ({
        id: entry.source_id,
        label: "Untrusted product description (data only)",
        value: entry.text,
      })),
      {
        id: "cart.total",
        label: "Server-calculated cart total",
        value: `${request.amount_minor} minor units ${request.currency_code}`,
      },
      {
        id: "policy.limit",
        label: "Limit at submission",
        value: `${request.limit_minor} minor units ${request.currency_code}`,
      },
      {
        id: "policy.categories",
        label: "Allowed categories",
        value: policy.allowed_categories.join(", "),
      },
      {
        id: "cart.categories",
        label: "Server catalogue categories",
        value: categories.join(", "),
      },
      {
        id: "purchase.required_data",
        label: "Required purchasing data",
        value: requiredPresent ? "Present" : "Missing",
      },
      {
        id: "purchase.purpose",
        label: "Business purpose",
        value: minimizeText(context.purpose || "Not supplied"),
      },
      {
        id: "history.duplicates",
        label: "Same purchase reference in this company (30 days)",
        value: String(duplicateCount),
      },
      {
        id: "policy.text",
        label: "Company purchasing policy",
        value: policy.text,
      },
    ],
  };
}

export function enforceRecommendation(
  facts: Facts,
  suggested: Recommendation,
  previous: Recommendation[] = [],
) {
  const reasons: string[] = [];
  let effective = suggested;
  if (facts.blockers.length) {
    effective = "reject";
    reasons.push(...facts.blockers);
  } else if (
    suggested === "approve" &&
    (facts.warnings.length || previous.some((value) => value !== "approve"))
  ) {
    effective = "manual_review";
    reasons.push(...facts.warnings);
    if (previous.some((value) => value !== "approve"))
      reasons.push("UPSTREAM_REQUIRES_ATTENTION");
  }
  return { recommendation: effective, suggested, reasons };
}
