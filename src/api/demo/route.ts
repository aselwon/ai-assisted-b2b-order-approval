import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { analysisConfig } from "../../agents/provider";
import { buyerPage } from "../../lib/buyer-page";
export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res
    .type("html")
    .send(
      buyerPage.replace(
        "__MODE_LABEL__",
        analysisConfig().provider === "demo"
          ? "DEMO / SIMULATED — deterministic responses, no external AI calls"
          : "LIVE / OpenAI — real model calls",
      ),
    );
}
