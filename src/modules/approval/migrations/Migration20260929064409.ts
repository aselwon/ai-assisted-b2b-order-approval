import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260929064409 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "approval_request" drop constraint if exists "approval_request_cart_id_unique";`,
    );
    this.addSql(
      `alter table if exists "approval_member" drop constraint if exists "approval_member_customer_id_unique";`,
    );
    this.addSql(
      `alter table if exists "approval_approver" drop constraint if exists "approval_approver_user_id_unique";`,
    );
    this.addSql(
      `create table if not exists "approval_approver" ("id" text not null, "user_id" text not null, "enabled" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "approval_approver_pkey" primary key ("id"));`,
    );
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_approval_approver_user_id_unique" ON "approval_approver" ("user_id") WHERE deleted_at IS NULL;`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_approval_approver_deleted_at" ON "approval_approver" ("deleted_at") WHERE deleted_at IS NULL;`,
    );

    this.addSql(
      `create table if not exists "approval_company" ("id" text not null, "name" text not null, "currency_code" text not null default 'pln', "approval_limit_minor" integer not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "approval_company_pkey" primary key ("id"));`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_approval_company_deleted_at" ON "approval_company" ("deleted_at") WHERE deleted_at IS NULL;`,
    );

    this.addSql(
      `create table if not exists "approval_member" ("id" text not null, "customer_id" text not null, "company_id" text not null, "can_submit" boolean not null default false, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "approval_member_pkey" primary key ("id"));`,
    );
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_approval_member_customer_id_unique" ON "approval_member" ("customer_id") WHERE deleted_at IS NULL;`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_approval_member_deleted_at" ON "approval_member" ("deleted_at") WHERE deleted_at IS NULL;`,
    );

    this.addSql(
      `create table if not exists "approval_request" ("id" text not null, "company_id" text not null, "company_name" text not null, "customer_id" text not null, "cart_id" text not null, "amount_minor" integer not null, "currency_code" text not null, "limit_minor" integer not null, "snapshot" jsonb not null, "status" text check ("status" in ('pending', 'approved', 'rejected')) not null default 'pending', "decided_by" text null, "decided_at" timestamptz null, "reason" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "approval_request_pkey" primary key ("id"));`,
    );
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_approval_request_cart_id_unique" ON "approval_request" ("cart_id") WHERE deleted_at IS NULL;`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_approval_request_deleted_at" ON "approval_request" ("deleted_at") WHERE deleted_at IS NULL;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "approval_approver" cascade;`);

    this.addSql(`drop table if exists "approval_company" cascade;`);

    this.addSql(`drop table if exists "approval_member" cascade;`);

    this.addSql(`drop table if exists "approval_request" cascade;`);
  }
}
