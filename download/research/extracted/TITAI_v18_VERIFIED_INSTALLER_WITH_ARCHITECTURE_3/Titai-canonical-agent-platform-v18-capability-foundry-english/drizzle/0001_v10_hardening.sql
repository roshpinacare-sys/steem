ALTER TABLE `runs` ADD `idempotency_key` text;
--> statement-breakpoint
ALTER TABLE `runs` ADD `max_output_tokens` integer DEFAULT 4096 NOT NULL;
--> statement-breakpoint
ALTER TABLE `runs` ADD `max_context_tokens` integer DEFAULT 32000 NOT NULL;
--> statement-breakpoint
ALTER TABLE `runs` ADD `deadline_at` integer;
--> statement-breakpoint
CREATE UNIQUE INDEX `runs_user_idempotency_uq` ON `runs` (`user_id`,`idempotency_key`);
--> statement-breakpoint
ALTER TABLE `approvals` ADD `expires_at` integer;
--> statement-breakpoint
UPDATE `approvals` SET `expires_at` = COALESCE(`created_at`, unixepoch() * 1000) + 86400000 WHERE `expires_at` IS NULL;
--> statement-breakpoint
ALTER TABLE `policies` ADD `owner_id` text REFERENCES `users`(`id`) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `policies` ADD `is_builtin` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `templates` ADD `owner_id` text REFERENCES `users`(`id`) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `provider_configs` ADD `api_key_version` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
CREATE TABLE `audit_redactions` (
  `id` text PRIMARY KEY NOT NULL,
  `audit_id` integer NOT NULL,
  `reason` text NOT NULL,
  `redacted_at` integer NOT NULL,
  FOREIGN KEY (`audit_id`) REFERENCES `audit_log`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `audit_redactions_audit_uq` ON `audit_redactions` (`audit_id`);
--> statement-breakpoint
CREATE TABLE `durable_jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `workflow_name` text NOT NULL,
  `payload` text NOT NULL,
  `status` text DEFAULT 'queued' NOT NULL,
  `checkpoint` text NOT NULL,
  `result` text,
  `error` text,
  `attempt` integer DEFAULT 0 NOT NULL,
  `max_attempts` integer DEFAULT 5 NOT NULL,
  `available_at` integer NOT NULL,
  `lease_owner` text,
  `lease_acquired_at` integer,
  `lease_expires_at` integer,
  `lease_heartbeat_at` integer,
  `version` integer DEFAULT 0 NOT NULL,
  `created_at` integer,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `durable_jobs_status_available_idx` ON `durable_jobs` (`status`,`available_at`);
--> statement-breakpoint
CREATE INDEX `durable_jobs_lease_idx` ON `durable_jobs` (`lease_expires_at`);
--> statement-breakpoint
CREATE TABLE `durable_receipts` (
  `key` text PRIMARY KEY NOT NULL,
  `job_id` text NOT NULL,
  `step_id` text NOT NULL,
  `operation` text NOT NULL,
  `input_hash` text NOT NULL,
  `status` text NOT NULL,
  `output` text,
  `error` text,
  `started_at` integer NOT NULL,
  `completed_at` integer,
  `worker_id` text NOT NULL,
  FOREIGN KEY (`job_id`) REFERENCES `durable_jobs`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `durable_receipts_job_idx` ON `durable_receipts` (`job_id`);
--> statement-breakpoint
CREATE TABLE `durable_outbox` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `idempotency_key` text NOT NULL,
  `aggregate_type` text NOT NULL,
  `aggregate_id` text NOT NULL,
  `type` text NOT NULL,
  `payload` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `attempts` integer DEFAULT 0 NOT NULL,
  `available_at` integer NOT NULL,
  `lease_owner` text,
  `lease_expires_at` integer,
  `last_error` text,
  `created_at` integer,
  `published_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `durable_outbox_idempotency_key_unique` ON `durable_outbox` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `durable_outbox_status_available_idx` ON `durable_outbox` (`status`,`available_at`);
