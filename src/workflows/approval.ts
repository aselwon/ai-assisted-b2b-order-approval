import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils";
import ApprovalModuleService, {
  CartSnapshot,
  Decision,
} from "../modules/approval/service";
import { APPROVAL_MODULE } from "../modules/approval";

const submitStep = createStep(
  "submit-order-approval",
  async (input: { customer_id: string; cart_id: string }, { container }) => {
    const service = container.resolve<ApprovalModuleService>(APPROVAL_MODULE);
    await service.membership(input.customer_id);
    const query = container.resolve(ContainerRegistrationKeys.QUERY);
    const { data: carts } = await query.graph({
      entity: "cart",
      fields: [
        "id",
        "customer_id",
        "currency_code",
        "completed_at",
        "total",
        "items.title",
        "items.product_description",
        "items.quantity",
        "items.unit_price",
      ],
      filters: { id: input.cart_id },
    });
    const cart = carts[0];
    if (!cart || cart.customer_id !== input.customer_id)
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "Cart not found");
    return new StepResponse(
      await service.submit(input.customer_id, cart as unknown as CartSnapshot),
    );
  },
);
export const submitApprovalWorkflow = createWorkflow(
  "submit-order-approval-workflow",
  (input: { customer_id: string; cart_id: string }) => {
    return new WorkflowResponse(submitStep(input));
  },
);

const decideStep = createStep(
  "decide-order-approval",
  async (input: Decision, { container }) => {
    const service = container.resolve<ApprovalModuleService>(APPROVAL_MODULE);
    return new StepResponse(await service.decide(input));
  },
);
export const decideApprovalWorkflow = createWorkflow(
  "decide-order-approval-workflow",
  (input: Decision) => {
    return new WorkflowResponse(decideStep(input));
  },
);
