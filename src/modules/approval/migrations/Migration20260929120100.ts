import { Migration } from "@medusajs/framework/mikro-orm/migrations";
export class Migration20260929120100 extends Migration {
  async up(): Promise<void> {
    this.addSql(`alter table approval_guardrail_violation add constraint violation_request_fk foreign key (request_id) references approval_request(id);`);
    this.addSql(`alter table approval_guardrail_violation add constraint violation_run_fk foreign key (run_id) references approval_analysis_run(id);`);
    this.addSql(`alter table approval_guardrail_violation add constraint violation_step_fk foreign key (step_id) references approval_agent_step(id);`);
    this.addSql(`alter table approval_guardrail_violation add constraint violation_attempt_fk foreign key (attempt_id) references approval_agent_attempt(id);`);
    this.addSql(`create index violation_run_history_idx on approval_guardrail_violation(run_id, created_at);`);
  }
  async down(): Promise<void> {
    this.addSql(`drop index if exists violation_run_history_idx;`);
    this.addSql(`alter table approval_guardrail_violation drop constraint if exists violation_request_fk, drop constraint if exists violation_run_fk, drop constraint if exists violation_step_fk, drop constraint if exists violation_attempt_fk;`);
  }
}
