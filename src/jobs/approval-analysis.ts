import { MedusaContainer } from "@medusajs/framework/types";
import { processNextAnalysis } from "../agents/execute";
export default async function approvalAnalysis(container: MedusaContainer) {
  if (
    process.env.NODE_ENV === "test" ||
    process.env.AGENT_WORKER_ENABLED === "false"
  )
    return;
  await processNextAnalysis(container);
}
export const config = {
  name: "b2b-agent-dispatcher",
  schedule: "*/2 * * * * *",
};
