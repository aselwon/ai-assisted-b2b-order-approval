import { model } from "@medusajs/framework/utils";
export const ApprovalRequest = model.define("approval_request", {
  id: model.id({ prefix: "approval" }).primaryKey(),
  company_id: model.text(),
  company_name: model.text(),
  customer_id: model.text(),
  cart_id: model.text().unique(),
  amount_minor: model.number(),
  currency_code: model.text(),
  limit_minor: model.number(),
  snapshot: model.json(),
  status: model.enum(["pending", "approved", "rejected"]).default("pending"),
  current_run_id: model.text().nullable(),
  analysis_status: model
    .enum(["waiting", "running", "completed", "error"])
    .default("waiting"),
  recommendation: model.enum(["approve", "reject", "manual_review"]).nullable(),
  decision_run_id: model.text().nullable(),
  decided_by: model.text().nullable(),
  decided_at: model.dateTime().nullable(),
  reason: model.text().nullable(),
});
