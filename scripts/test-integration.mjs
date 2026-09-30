import { spawnSync } from "node:child_process";
const env = {
  ...process.env,
  AGENT_PROVIDER: "demo",
  AGENT_WORKER_ENABLED: "false",
  AGENT_DEMO_DELAY_MS: "0",
  AGENT_RETRY_DELAY_MS: "0",
  OPENAI_API_KEY: "test-placeholder-not-a-real-key",
  DB_HOST: process.env.DB_HOST || "localhost",
  DB_USERNAME: process.env.DB_USERNAME || "medusa",
  DB_PASSWORD: process.env.DB_PASSWORD || "medusa",
  DB_PORT: process.env.DB_PORT || "5440",
  NODE_OPTIONS: [process.env.NODE_OPTIONS, "--experimental-vm-modules"]
    .filter(Boolean)
    .join(" "),
};
// Medusa creates and drops an isolated test database; it does not clear the demo database.
const result = spawnSync(
  process.execPath,
  [
    "node_modules/jest/bin/jest.js",
    "--runInBand",
    "--forceExit",
    ...process.argv.slice(2),
  ],
  { env, stdio: "inherit" },
);
process.exit(result.status ?? 1);
