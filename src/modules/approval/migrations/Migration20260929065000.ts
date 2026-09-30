import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260929065000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      `alter table approval_company add constraint approval_company_policy_check check (approval_limit_minor >= 0 and currency_code = 'pln');`,
    );
    this.addSql(
      `alter table approval_member add constraint approval_member_company_fk foreign key (company_id) references approval_company(id);`,
    );
    this.addSql(
      `alter table approval_request add constraint approval_request_company_fk foreign key (company_id) references approval_company(id);`,
    );
    this.addSql(
      `alter table approval_request add constraint approval_request_amount_check check (amount_minor > limit_minor and limit_minor >= 0 and currency_code = 'pln');`,
    );
    this
      .addSql(`alter table approval_request add constraint approval_request_decision_check check (
      (status = 'pending' and decided_by is null and decided_at is null and reason is null) or
      (status in ('approved', 'rejected') and decided_by is not null and decided_at is not null and reason is not null and length(trim(reason)) between 1 and 1000)
    );`);
    this.addSql(
      `create index approval_request_company_created_idx on approval_request (company_id, created_at desc) where deleted_at is null;`,
    );
    this.addSql(
      `create index approval_request_status_created_idx on approval_request (status, created_at desc) where deleted_at is null;`,
    );
  }
  async down(): Promise<void> {
    this.addSql(`drop index if exists approval_request_status_created_idx;`);
    this.addSql(`drop index if exists approval_request_company_created_idx;`);
    this.addSql(
      `alter table approval_request drop constraint if exists approval_request_decision_check;`,
    );
    this.addSql(
      `alter table approval_request drop constraint if exists approval_request_amount_check;`,
    );
    this.addSql(
      `alter table approval_request drop constraint if exists approval_request_company_fk;`,
    );
    this.addSql(
      `alter table approval_member drop constraint if exists approval_member_company_fk;`,
    );
    this.addSql(
      `alter table approval_company drop constraint if exists approval_company_policy_check;`,
    );
  }
}
