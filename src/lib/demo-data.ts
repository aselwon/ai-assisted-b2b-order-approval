import { INJECTION_DESCRIPTION } from "../agents/guardrails";
import { randomUUID } from "node:crypto";
import { DEFAULT_POLICY } from "../agents/policy";
import { MedusaContainer } from "@medusajs/framework/types";
import { Modules, MedusaError } from "@medusajs/framework/utils";
import ApprovalModuleService from "../modules/approval/service";
import { APPROVAL_MODULE } from "../modules/approval";

export const DEMO_PASSWORD = "RigbyDemo2026!";
export async function createDemoCart(
  container: MedusaContainer,
  customerId: string,
  basket:
    | "over-limit"
    | "under-limit"
    | "clean"
    | "manual"
    | "failure"
    | "injection",
) {
  const service = container.resolve<ApprovalModuleService>(APPROVAL_MODULE);
  const member = await service.membership(customerId);
  if (!member.can_submit)
    throw new MedusaError(
      MedusaError.Types.FORBIDDEN,
      "Submission permission required",
    );
  // Server-owned demo catalogue, never a client-provided amount, price or company ID.
  const cart = await container.resolve(Modules.CART).createCarts({
    customer_id: customerId,
    currency_code: "pln",
    items: [
      {
        title: "Office supply kit",
        product_description:
          basket === "injection"
            ? INJECTION_DESCRIPTION
            : "Office supplies for daily work.",
        quantity: basket === "under-limit" ? 1 : basket === "manual" ? 20 : 3,
        unit_price: 450,
        requires_shipping: false,
        is_custom_price: true,
      },
    ],
  });
  // Purchasing context is server-owned, not cart metadata editable via a storefront.
  await service.createPurchaseContexts({
    cart_id: cart.id,
    scenario:
      basket === "injection"
        ? "injection"
        : basket === "failure"
          ? "failure"
          : basket === "manual"
            ? "manual"
            : "clean",
    data: {
      category_ids: ["office_supplies"],
      cost_center: "OPS-2026",
      purchase_ref: randomUUID(),
      purpose:
        basket === "manual"
          ? "Additional kits for an unplanned site expansion; budget confirmation pending."
          : "Quarterly onboarding supplies for the studio.",
    },
  });
  return container
    .resolve(Modules.CART)
    .retrieveCart(cart.id, { relations: ["items"] });
}

export async function seedDemo(container: MedusaContainer) {
  const approval = container.resolve<ApprovalModuleService>(APPROVAL_MODULE);
  const auth = container.resolve(Modules.AUTH);
  const users = container.resolve(Modules.USER);
  const customers = container.resolve(Modules.CUSTOMER);

  async function identity(
    email: string,
    actorType: "user" | "customer",
    id: string,
  ) {
    const result = await auth.register("emailpass", {
      body: { email, password: DEMO_PASSWORD },
    });
    if (result.success && result.authIdentity) {
      await auth.updateAuthIdentities({
        id: result.authIdentity.id,
        app_metadata: { [`${actorType}_id`]: id },
      });
    } else {
      // An existing account is retained, including its password. Never reset it on reseed.
      const existing = await auth.listAuthIdentities(
        { provider_identities: { entity_id: email, provider: "emailpass" } },
        { relations: ["provider_identities"] },
      );
      if (
        !existing.some(
          (entry: any) => entry.app_metadata?.[`${actorType}_id`] === id,
        )
      )
        throw new Error(`Cannot link demo identity: ${email}`);
    }
  }
  async function customer(email: string, firstName: string) {
    let [record] = await customers.listCustomers({ email });
    if (!record)
      record = await customers.createCustomers({
        email,
        first_name: firstName,
        last_name: "Demo",
        has_account: true,
      });
    await identity(email, "customer", record.id);
    return record;
  }
  async function user(email: string, firstName: string) {
    let [record] = await users.listUsers({ email });
    if (!record)
      record = await users.createUsers({
        email,
        first_name: firstName,
        last_name: "Demo",
      });
    await identity(email, "user", record.id);
    return record;
  }
  const buyer = await customer("buyer@acme.demo", "Alex");
  const outsider = await customer("buyer@other.demo", "Ola");
  const viewer = await customer("viewer@acme.demo", "Sam");
  const manager = await user("approver@rigby.demo", "Morgan");
  const staff = await user("staff@rigby.demo", "Taylor");
  for (const data of [
    {
      id: "company_acme",
      name: "Acme Studio",
      approval_limit_minor: 100000,
      currency_code: "pln",
    },
    {
      id: "company_other",
      name: "Other Company",
      approval_limit_minor: 50000,
      currency_code: "pln",
    },
  ]) {
    const existing = await approval.listCompanies({ id: data.id });
    if (!existing.length)
      await approval.createCompanies({ ...data, policy: DEFAULT_POLICY });
    else if (!existing[0].policy)
      await approval.updateCompanies({ id: data.id, policy: DEFAULT_POLICY });
  }
  for (const data of [
    { customer_id: buyer.id, company_id: "company_acme", can_submit: true },
    { customer_id: viewer.id, company_id: "company_acme", can_submit: false },
    { customer_id: outsider.id, company_id: "company_other", can_submit: true },
  ]) {
    if (!(await approval.listMembers({ customer_id: data.customer_id })).length)
      await approval.createMembers(data);
  }
  if (!(await approval.listApprovers({ user_id: manager.id })).length)
    await approval.createApprovers({ user_id: manager.id, enabled: true });
  return { buyer, outsider, viewer, manager, staff };
}
