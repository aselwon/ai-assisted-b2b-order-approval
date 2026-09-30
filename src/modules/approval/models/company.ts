import { model } from "@medusajs/framework/utils";
export const Company = model.define("approval_company", {
  id: model.id({ prefix: "company" }).primaryKey(),
  name: model.text(),
  currency_code: model.text().default("pln"),
  policy: model.json().nullable(),
  approval_limit_minor: model.number(),
});
