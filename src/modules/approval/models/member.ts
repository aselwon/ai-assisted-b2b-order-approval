import { model } from "@medusajs/framework/utils";
export const Member = model.define("approval_member", {
  id: model.id({ prefix: "member" }).primaryKey(),
  customer_id: model.text().unique(),
  company_id: model.text(),
  can_submit: model.boolean().default(false),
});
