# Initial Delivery — B2B Order Approval

Historical record of the original non-agent demo. The later AI and guardrails implementation is documented in [DELIVERY.md](../DELIVERY.md).

## Specification and actual work split

The original scope was a local Medusa v2 recruitment demo: an authorised company customer submits an over-limit cart and an authorised administrator makes one final decision with a reason. PostgreSQL retains the request, cart snapshot and decision audit. The project does not place orders or take payments.

Official Medusa documentation and the workspace were checked before implementation. The repository was empty. The project, including `.git`, moved from `Documents/ChatGPT/RIGBY TASK` to `Desktop/projects/portfolio/b2b-order-approval`. No branch or worktree was created. The empty original directory was recreated only because the browser tool required an existing working directory; application code lives in the new location.

The primary agent and a helper named `inspect` actually worked on the project:

- Helper: repository/tool inspection, moving the directory, npm/starter inspection, dependency installation, Docker/PostgreSQL startup, migration generation/execution, typecheck/build/test/seed runs, library/error-mapping inspection, README and Git-state checks.
- Primary: technical specification, architecture, module and authorisation policy, workflows, endpoints, both UIs, seed/tests, database constraints, diagnosis and code fixes, browser scenarios and delivery record.

The helper did not implement application logic. No independent security review or human review took place. Verification consisted of primary-agent code review, typechecking, API tests against real Medusa/PostgreSQL and UI tests.

## Architecture decisions

- Medusa **2.21.2**, pinned dependencies/lockfile, TypeScript, native DML, `MedusaService`, `createWorkflow`/`createStep`, and Admin `defineRouteConfig`.
- The `approval` module stores companies, customer memberships, administrator grants and requests. Customer/Admin IDs are logical references to Medusa modules; internal company relationships have PostgreSQL foreign keys. No Mercur or full B2B suite was installed.
- Standard Medusa `emailpass` authentication: buyer actor `customer`, administrator actor `user`. An Admin login alone is insufficient: the server requires an enabled `Approver` grant. Membership and `can_submit` are server-side.
- The client submits only `cart_id`. Server code checks cart owner, open state, currency and items; Query supplies computed totals; the module supplies company/limit. Strict Zod schemas reject extra company, amount and decision-actor fields.
- Amounts are minor units, explicitly converted from Medusa v2 major units. PLN only. The total must be **greater** than the limit; equality does not require this workflow.
- A unique index enforces one request per cart. Duplicates return `409`. Rejection requires a new cart/request for resubmission and preserves history.
- A parameterised transactional `UPDATE ... WHERE status = 'pending' RETURNING ...` stores the actor, timestamp and reason atomically. Concurrent decisions yield one winner and one `409`, independently of process-memory locks.
- The original workflow has one atomic write step and no later effect needing compensation. The database stores the wait for a human.
- Item/amount/currency/limit snapshots remain immutable even if the cart later changes. Approval does **not** enforce a future checkout; checkout integration would need to check consistency again.
- Company-scoped reads return `404` for foreign carts/requests; missing permission `403`, invalid authentication `401`, invalid input `400`.

## Problems found and fixed

1. Initial sandboxed npm access did not respond; permitted network access resolved version 2.21.2. Docker CLI existed but the daemon was stopped, so Docker Desktop and project PostgreSQL were started.
2. Initial dependencies could not resolve default `@medusajs/draft-order`. The matching 2.21.2 package and required peer `@medusajs/ui` 4.2.6 were added. Migrations/build then passed.
3. First integration run: **9/13**. `MedusaError.Types.NOT_ALLOWED` mapped to 400, so permission errors changed to `FORBIDDEN` for 403. Serialisation omitted undefined pending `decided_at`; the test now asserts no decision without requiring literal JSON null.
4. Typecheck caught an incorrect `updateLineItems` test overload. The corrected setup asserts quantity really becomes 10 before checking snapshot immutability.
5. Second integration run: **12/13**. Medusa maps unique violations to `INVALID_DATA`, dropping the PostgreSQL code. After rollback, a scoped `cart_id + customer_id` duplicate lookup returns 409 without disclosing foreign requests.
6. A development restart interrupted a UI request (`Failed to fetch`) and invalidated the in-memory Admin session. Reload/login restored access to the persistent request/decision. README documents local sessions. A second server hit occupied port 9000 and the extra process was stopped.
7. PostgreSQL constraints enforce a nonnegative limit, decision-field/status consistency, an over-limit amount and company foreign keys. These checks do not rely solely on forms.

## Browser verification

On the real local server, the buyer created and submitted two PLN 1,350 carts against a PLN 1,000 limit. Admin approved one and rejected the other with distinct reasons. The refreshed buyer page displayed both final statuses and matching reasons. List, details, snapshot and disabled decisions without a reason were checked. Screenshots are in `docs/screenshots/`.

## Final results and limitations

Executed on 29 September 2026, macOS, Node 22.23.1, npm 10.9.8, Docker Compose 5.1.4 and PostgreSQL 17:

- Migrations, including custom constraints: successful.
- Seed: successful twice consecutively, without resetting passwords.
- Typecheck: successful.
- Integration tests: **13/13, 1/1 suite**; local log `docs/integration-test.log`. A separate database preserves demo data.
- Backend/Admin build: successful.
- `git diff --check`: no whitespace errors; files were new and not yet committed.
- UI: complete approval and rejection verified on Admin and buyer pages.
- Explicit process restart followed by `npm run demo -- status approval_01M3NYW36WZ8HAT79XJWKK07RB`: successful, with approved status, original snapshot, actor, time and reason retained.
- `npm audit --json`: **74 findings — 6 moderate, 68 high, 0 critical**, recorded in `docs/npm-audit.json`. No `audit fix --force` was applied. Dependency security remains a limitation despite passing functional checks.

This was a local demo, not production deployment. No checkout/payments, full catalogue, stock, taxes, shipping, multiple currencies, membership/grant management UI, notifications or full RBAC. Business data persists; Admin sessions and default event/locking infrastructure remain local. Windows/Linux and multiple application instances were not tested. The concurrency test uses simultaneous HTTP requests within one instance; cross-process safety follows from the PostgreSQL conditional write, not an executed multi-instance test.
