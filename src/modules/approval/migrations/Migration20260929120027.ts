import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260929120027 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "approval_guardrail_violation" ("id" text not null, "request_id" text not null, "run_id" text not null, "step_id" text null, "attempt_id" text null, "phase" text check ("phase" in ('input', 'output', 'budget', 'execution')) not null, "code" text not null, "detail" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "approval_guardrail_violation_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_approval_guardrail_violation_deleted_at" ON "approval_guardrail_violation" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "approval_purchase_context" drop constraint if exists "approval_purchase_context_scenario_check";`);

    this.addSql(`alter table if exists "approval_purchase_context" add constraint "approval_purchase_context_scenario_check" check("scenario" in ('clean', 'manual', 'failure', 'injection'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "approval_guardrail_violation" cascade;`);

    this.addSql(`alter table if exists "approval_purchase_context" drop constraint if exists "approval_purchase_context_scenario_check";`);

    this.addSql(`alter table if exists "approval_purchase_context" add constraint "approval_purchase_context_scenario_check" check("scenario" in ('clean', 'manual', 'failure'));`);
  }

}
