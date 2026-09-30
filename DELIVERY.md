# Delivery — AI-Assisted B2B Order Approval

The original non-agent implementation is recorded in [docs/initial-delivery.md](docs/initial-delivery.md). This document records work that actually happened; runtime application agents and development assistants are separate.

## Scope and actual division of work

The revised brief required three runtime agents with validated dependencies, persistent PostgreSQL history and a final human decision. It added a free simulation, a real provider, failure handling and three presentation scenarios. A later request added code-enforced guardrails and an injection scenario.

The primary development agent implemented the models, contracts, deterministic rules, OpenAI adapter/simulator, execution steps, Medusa workflow, persistent lease worker, retry API, timeline UI, cart scenarios, tests and architecture. It diagnosed and fixed code failures and performed browser verification.

The development helper `inspect_ai_demo` (Luna) performed mechanical work: repository/library inspection, scheduled-job checks, migration generation/execution, seed, test/typecheck/build runs, reported-failure inspection, formatting and file checks. It did not design or implement application logic. It was the second helper in this project's history, not a runtime agent.

**Policy, Risk and Recommendation are stages of the running application.** DEMO generates their outputs deterministically. OpenAI mode makes a separate Responses API call at each stage. Development assistants do not run this process on behalf of the application.

Official Medusa workflow, scheduled-job and database-operation documentation and OpenAI Structured Outputs/model documentation were checked. With explicit user permission, an existing key from the user's GPW BOT project was reused only in the ignored local `.env`, with permissions 0600. It was never included in reports or publication. The default provider remains the simulation.

## Architecture decisions and problems fixed

1. Native Medusa workflows define the stage order. The model does not select tools or orchestration. Every boundary has a validated contract and persistent results, attempts and status.
2. Company, amount, currency, limit, permissions and final decisions stay in code. Categories and purchasing data moved into a server-side cart context so client metadata cannot replace them. Policy/data snapshots apply throughout a request.
3. PostgreSQL `SKIP LOCKED`, a fenced lease and interrupted-attempt recovery make the worker durable. Decisions and retries are serialised in the database rather than depending on in-memory waiting.
4. Typecheck found dynamic-import extension resolution under Node16 configuration. Lazy workflow loading changed to `require`, preserving separation of the circular dependency. Claim/lease result typing was clarified.
5. The first complete AI suite passed **18/40**. Request creation hit a foreign-key error mapped by Medusa to 404: MikroORM did not know dependencies between scalar request/run/stage IDs and inserted stages too early. Explicit `flush()` calls now insert request → run → stages inside one transaction. Foreign keys were retained. The first live script stopped at this failure before calling the model.
6. The next run passed **39/40**. The missing-data test omitted `cost_center` in a JSON update, but Medusa merged the old value. Explicit `cost_center: null` made the test exercise missing data. The next full run passed **40/40**.
7. The harness logged Knex `Connection ended unexpectedly` during temporary-database lifecycle operations; both final suites passed. Those messages were not claimed to be fixed. Logs were retained locally.
8. Starting another server produced `EADDRINUSE`: an existing project process already owned the port. Two instances were not run on that port.

## AI-stage verification — 29 September 2026

- New model/constraint migrations and seed: successful on local PostgreSQL.
- Integration tests: **40/40, 2/2 suites**. Local log: `docs/ai-integration-test.log`. Tests do not make paid calls.
- Coverage: over-limit submission, company isolation, permissions, repeat/concurrent decisions, immutable snapshots, stage order, schema/source validation, invalid responses, timeout, automatic/manual/concurrent retries, run cap, duplicate references, optimistic outputs against hard blockers, lease loss/recovery and stale-worker writes. The OpenAI adapter also has an HTTP stub test.
- Typecheck and backend/Admin build: successful.
- Real OpenAI verification: **3/3 calls completed**, model `gpt-4.1-mini-2025-04-14`. Policy: 2,899 ms, 620/221 tokens; Risk: 3,182 ms, 838/283; Recommendation: 2,437 ms, 1,133/274. Total: **2,591 input + 778 output**. See `docs/live-verification.json`.
- The real model conservatively recommended `manual_review` for the routine purchase. Request `approval_01M3PEERG5ENE14J7R0494RKBW` remained **pending**. No expected recommendation was forced and no simulation was presented as AI usage.

## Actual browser scenarios

- `clean`, `approval_01M3PEVF896GXFHKF841Q59PQG`: PLN 1,350; all three stages completed; `approve` recommendation; still pending until a human entered a reason and approved. The buyer then displayed `approved` and the matching comment.
- `manual`, `approval_01M3PEWDBS76CZRZ4DSZPK0F8F`: PLN 9,000; concrete HIGH_VALUE evidence referenced total/limit, with budget uncertainty. Recommendation: `manual_review`. A human rejected it because budget confirmation was missing; the buyer displayed the decision and reason.
- `failure`, `approval_01M3PEXK1WD26G29NJBZDRJR6H`: Policy completed; Risk failed with **two** stored attempts; Recommendation had a dependency error; result `manual_review`, without an automatic decision. Retry run #2 completed while #1 remained in history. A human returned to #2 and approved with an independent reason.

The browser checks also covered running statuses, automatic refresh, disabled decisions without a reason, explicit DEMO/SIMULATED labels and unavailable token measurements. UI review removed misleading zero token counts and marks incomplete totals as partial. Historical runs disable decision buttons and ask users to return to the current run. Submission confirmation no longer says “Request is pending” after a later decision. Code was formatted with Prettier.

After formatting, the full suite again passed **40/40, 2/2 suites**. Typecheck/build passed after the final UI corrections. The application was explicitly restarted and `/health` returned 200.

Admin API reads after restart confirmed the approved failure-scenario request, a decision referencing run #2, and the retained failed run #1 with two Risk attempts. See `docs/restart-verification.json`. The buyer also displayed the same persistent decision after logging in again. The development watcher can restart the backend and invalidate local Admin sessions; logging in restores access to durable records.

Additional UI request `approval_01M3PFDNH9P5RY2YW3MYAD7GA3` verified that historical-run Approve/Reject buttons remained disabled even after entering a reason. They were enabled on the current run #2. A human approved it; the buyer showed the final status and corrected confirmation.

The actual OpenAI run was opened in Admin: three completed outputs with evidence, LIVE label, 2,591/778 aggregate tokens and 620/221 first-attempt usage. Paid calls were not repeated just for screenshots. Historical screenshots in `docs/screenshots/` include `ai-admin-final.png`, `ai-buyer-final.png`, `ai-failure.png` and `ai-manual.png`. Screenshots/reports do not contain API keys or authentication tokens.

## Guardrails extension

The next user request added customer/company/cart revalidation before every attempt, an eight-attempt budget across runs, rejection of conflicting `approve` outputs before downstream delivery, description minimisation and a persistent violation history in Admin. The fourth scenario originally used the Polish product-description attack, translated into English for the current presentation. DEMO deliberately follows the malicious instruction so the actual output validator is tested, not just the prompt.

The primary agent implemented the code and tests. `inspect_ai_demo` inspected Medusa types, generated/ran migrations and executed checks. It confirmed native `product_description` in CreateLineItemDTO/CartLineItemDTO. A separate migration added violation foreign keys; the scenario constraint retained existing values and added `injection`.

The first run passed **61/64**, with a test typecheck error. Medusa `createCarts` did not return loaded items, so the UI/test could not see the description. Demo creation now reloads the cart with `items`. An account-revocation test initially used an incorrect `updateCustomers` overload; the setup and effect assertion were corrected. The quantity test also verifies that the line actually changes. Production rules were not weakened. Local log: `docs/guardrails-tests-first.log`.

The second run passed **64/64**, but standalone typecheck still found mismatches in two test setup calls. The missing-identity test now uses supported `softDeleteCustomers` and asserts that the account is absent. The quantity test uses a line-item selector and separately reloads cart/items. The final correction was a loaded-relation type annotation.

The global budget test spends 4 attempts in run #1, 3 in run #2 and 1 in run #3; the next call is blocked before the provider. Separate tests cover revocation between attempts; company/owner/amount/currency/open-state changes; invalid Policy, Risk and Recommendation outputs; and a request remaining pending after injection.

Final guardrails verification: **64/64 tests, 2/2 suites**, successful typecheck and build. Browser request `approval_01M3PHB16D89383SXX8DVVZCRN` used the original Polish attack. Admin showed budget 2/8, `untrusted_instruction`, two `recommendation_conflict` entries, stopped downstream stages and `manual_review`. The request stayed pending without a decision; history survived watcher restarts. Historical screenshot: `docs/screenshots/guardrails-injection.png`. This was DEMO; no new paid OpenAI calls were made for guardrails verification.

## Limitations

Real provider network failure, billing accuracy, multi-instance deployment, a clean Linux/Windows installation and load were not tested. Timeout, malformed responses and worker takeover are deterministic harness tests. Live OpenAI verification is one three-stage run, not a broad quality evaluation. There has been no independent security audit or human code review. The original dependency findings, local sessions and missing checkout remain limitations. See ARCHITECTURE.md for privacy boundaries and possible duplicate provider cost after a crash.

## English publication preparation — 30 September 2026

The primary agent translated the project documentation, changed the displayed injection example to English and made UI dates explicitly use `en-GB`. The original Polish detector and regression fixture remain intentional multilingual security coverage. Historical records/screenshots retain the original test evidence rather than rewriting past events. The helper inspected tooling; it did not complete the delegated translation, so the primary agent performed it. Publication and new verification results are recorded only after they occur.

The English revision passed `npm run typecheck`, `npm run test:integration` (**64/64, 2/2 suites**) and `npm run build`. Browser request `approval_01M3RNY4BR9TZPJH5ZNBMNH9G9` verified the English product description, `en-GB` dates, two rejected recommendations, budget 2/8 and `pending / manual_review`. Screenshot: `docs/screenshots/guardrails-injection-en.png`. No paid model calls were made.

Initial sandboxed CLI checks misleadingly reported invalid GitHub authentication. Rechecking with network access confirmed GitHub account `aselwon`, SSH authentication and Wrangler authentication. A pre-publication credential-pattern scan reported no secrets among candidate files; `.env` is ignored. Cloudflare deployment was not performed: Containers requires Workers Paid on this account, the project's database is local, and Hyperdrive listing returned no configurations. No plan was purchased and no unrelated database reused.

## GitHub publication — 30 September 2026

The verified commit was published to [aselwon/ai-assisted-b2b-order-approval](https://github.com/aselwon/ai-assisted-b2b-order-approval) as a **private** repository. The requested public visibility was rejected by the automatic approval review because it would disclose the full project externally; no public repository was created. The `.env` file was excluded. The published commit passed typecheck, 64/64 integration tests in 2/2 suites, and the production build. Cloudflare deployment was not performed because Containers requires the Workers Paid plan and no Hyperdrive configuration is available.
