import { ExecArgs } from "@medusajs/framework/types";
import { seedDemo } from "../lib/demo-data";
export default async function seed({ container }: ExecArgs) {
  await seedDemo(container);
  console.log(
    "Demo accounts and companies ready. Open http://localhost:9000/demo. See README for local demo credentials.",
  );
}
