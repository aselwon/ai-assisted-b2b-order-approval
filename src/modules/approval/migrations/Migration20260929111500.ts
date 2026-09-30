import { Migration } from "@medusajs/framework/mikro-orm/migrations";
export class Migration20260929111500 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      `alter table approval_analysis_run add constraint analysis_request_fk foreign key (request_id) references approval_request(id);`,
    );
    this.addSql(
      `create unique index analysis_request_sequence_unique on approval_analysis_run (request_id, sequence);`,
    );
    this.addSql(
      `create unique index analysis_step_name_unique on approval_agent_step (run_id, name);`,
    );
    this.addSql(
      `alter table approval_agent_step add constraint agent_step_run_fk foreign key (run_id) references approval_analysis_run(id);`,
    );
    this.addSql(
      `create unique index agent_attempt_number_unique on approval_agent_attempt (step_id, number);`,
    );
    this.addSql(
      `alter table approval_agent_attempt add constraint attempt_step_fk foreign key (step_id) references approval_agent_step(id);`,
    );
    this.addSql(
      `alter table approval_agent_attempt add constraint attempt_run_fk foreign key (run_id) references approval_analysis_run(id);`,
    );
    this.addSql(
      `alter table approval_request add constraint current_analysis_fk foreign key (current_run_id) references approval_analysis_run(id);`,
    );
    this.addSql(
      `alter table approval_request add constraint decision_analysis_fk foreign key (decision_run_id) references approval_analysis_run(id);`,
    );
    this.addSql(
      `alter table approval_analysis_run add constraint analysis_sequence_check check (sequence between 1 and 3);`,
    );
    this.addSql(
      `alter table approval_agent_attempt add constraint attempt_number_check check (number between 1 and 2);`,
    );
    this.addSql(
      `create index analysis_queue_idx on approval_analysis_run (status, lease_until, created_at) where deleted_at is null;`,
    );
  }
  async down(): Promise<void> {
    this.addSql(`drop index if exists analysis_queue_idx;`);
    this.addSql(
      `alter table approval_agent_attempt drop constraint if exists attempt_number_check, drop constraint if exists attempt_step_fk, drop constraint if exists attempt_run_fk;`,
    );
    this.addSql(
      `alter table approval_request drop constraint if exists current_analysis_fk, drop constraint if exists decision_analysis_fk;`,
    );
    this.addSql(
      `alter table approval_agent_step drop constraint if exists agent_step_run_fk;`,
    );
    this.addSql(
      `alter table approval_analysis_run drop constraint if exists analysis_request_fk, drop constraint if exists analysis_sequence_check;`,
    );
    this.addSql(`drop index if exists agent_attempt_number_unique;`);
    this.addSql(`drop index if exists analysis_step_name_unique;`);
    this.addSql(`drop index if exists analysis_request_sequence_unique;`);
  }
}
