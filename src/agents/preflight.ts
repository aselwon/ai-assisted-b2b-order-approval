import { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import ApprovalModuleService, { CartSnapshot } from "../modules/approval/service";
import { APPROVAL_MODULE } from "../modules/approval";

const items = (rows: CartSnapshot["items"]) => rows.map(item => ({
  title: item.title, quantity: Number(item.quantity), unit_price: Number(item.unit_price),
  product_description: item.product_description || "",
})).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

/** Re-read authoritative state before EVERY outbound attempt, including retries. */
export async function preflight(container: MedusaContainer, requestId: string): Promise<string | null> {
  const service = container.resolve<ApprovalModuleService>(APPROVAL_MODULE);
  try {
    const request = await service.retrieveApprovalRequest(requestId);
    const query = container.resolve(ContainerRegistrationKeys.QUERY);
    const { data: customers } = await query.graph({ entity: "customer", fields: ["id", "has_account"], filters: { id: request.customer_id } });
    if (!customers[0]?.has_account) return "identity_invalid";
    const [member] = await service.listMembers({ customer_id: request.customer_id, company_id: request.company_id, can_submit: true });
    const [company] = await service.listCompanies({ id: request.company_id });
    if (!member || !company) return "company_access_denied";
    const { data: carts } = await query.graph({ entity: "cart", fields: ["id", "customer_id", "completed_at", "currency_code", "total", "items.title", "items.product_description", "items.quantity", "items.unit_price"], filters: { id: request.cart_id } });
    const cart = carts[0] as unknown as CartSnapshot | undefined;
    const snapshot = request.snapshot as any;
    if (!cart || cart.customer_id !== request.customer_id || cart.completed_at ||
      cart.currency_code !== "pln" || cart.currency_code !== request.currency_code ||
      !Number.isSafeInteger(Math.round(Number(cart.total) * 100)) ||
      Math.round(Number(cart.total) * 100) !== request.amount_minor || request.amount_minor <= request.limit_minor ||
      !cart.items?.length || cart.items.length > 20 ||
      cart.items.some(item => !Number.isSafeInteger(Number(item.quantity)) || Number(item.quantity) < 1 || !Number.isFinite(Number(item.unit_price)) || Number(item.unit_price) < 0) ||
      JSON.stringify(items(cart.items)) !== JSON.stringify(items(snapshot.items))) return "cart_invalid";
    return null;
  } catch { return "preflight_unavailable"; }
}
