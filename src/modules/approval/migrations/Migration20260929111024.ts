import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260929111024 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "approval_purchase_context" drop constraint if exists "approval_purchase_context_cart_id_unique";`,
    );
    this.addSql(
      `create table if not exists "approval_agent_attempt" ("id" text not null, "run_id" text not null, "step_id" text not null, "number" integer not null, "status" text check ("status" in ('running', 'completed', 'error')) not null, "provider" text not null, "model" text not null, "started_at" timestamptz not null, "finished_at" timestamptz null, "duration_ms" integer null, "input_tokens" integer null, "output_tokens" integer null, "error_code" text null, "output" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "approval_agent_attempt_pkey" primary key ("id"));`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_approval_agent_attempt_deleted_at" ON "approval_agent_attempt" ("deleted_at") WHERE deleted_at IS NULL;`,
    );

    this.addSql(
      `create table if not exists "approval_agent_step" ("id" text not null, "run_id" text not null, "name" text check ("name" in ('policy', 'risk', 'recommendation')) not null, "position" integer not null, "status" text check ("status" in ('waiting', 'running', 'completed', 'error')) not null default 'waiting', "input" jsonb null, "output" jsonb null, "error_code" text null, "started_at" timestamptz null, "finished_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "approval_agent_step_pkey" primary key ("id"));`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_approval_agent_step_deleted_at" ON "approval_agent_step" ("deleted_at") WHERE deleted_at IS NULL;`,
    );

    this.addSql(
      `create table if not exists "approval_analysis_run" ("id" text not null, "request_id" text not null, "sequence" integer not null, "provider" text check ("provider" in ('demo', 'openai')) not null, "model" text not null, "prompt_version" text not null default 'b2b-v1', "status" text check ("status" in ('waiting', 'running', 'completed', 'error')) not null default 'waiting', "input" jsonb not null, "recommendation" text check ("recommendation" in ('approve', 'reject', 'manual_review')) null, "summary" text null, "guardrails" jsonb null, "started_at" timestamptz null, "finished_at" timestamptz null, "lease_token" text null, "lease_until" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "approval_analysis_run_pkey" primary key ("id"));`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_approval_analysis_run_deleted_at" ON "approval_analysis_run" ("deleted_at") WHERE deleted_at IS NULL;`,
    );

    this.addSql(
      `create table if not exists "approval_purchase_context" ("id" text not null, "cart_id" text not null, "scenario" text check ("scenario" in ('clean', 'manual', 'failure')) not null default 'clean', "data" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "approval_purchase_context_pkey" primary key ("id"));`,
    );
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_approval_purchase_context_cart_id_unique" ON "approval_purchase_context" ("cart_id") WHERE deleted_at IS NULL;`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_approval_purchase_context_deleted_at" ON "approval_purchase_context" ("deleted_at") WHERE deleted_at IS NULL;`,
    );

    this.addSql(
      `alter table if exists "approval_company" add column if not exists "policy" jsonb null;`,
    );

    this.addSql(
      `alter table if exists "approval_request" add column if not exists "current_run_id" text null, add column if not exists "analysis_status" text check ("analysis_status" in ('waiting', 'running', 'completed', 'error')) not null default 'waiting', add column if not exists "recommendation" text check ("recommendation" in ('approve', 'reject', 'manual_review')) null, add column if not exists "decision_run_id" text null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "approval_agent_attempt" cascade;`);

    this.addSql(`drop table if exists "approval_agent_step" cascade;`);

    this.addSql(`drop table if exists "approval_analysis_run" cascade;`);

    this.addSql(`drop table if exists "approval_purchase_context" cascade;`);

    this.addSql(
      `alter table if exists "approval_company" drop column if exists "policy";`,
    );

    this.addSql(
      `alter table if exists "approval_request" drop column if exists "current_run_id", drop column if exists "analysis_status", drop column if exists "recommendation", drop column if exists "decision_run_id";`,
    );
  }
}
