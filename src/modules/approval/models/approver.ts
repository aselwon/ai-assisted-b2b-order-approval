import { model } from "@medusajs/framework/utils";
export const Approver = model.define("approval_approver", {
  id: model.id({ prefix: "approver" }).primaryKey(),
  user_id: model.text().unique(),
  enabled: model.boolean().default(true),
});
