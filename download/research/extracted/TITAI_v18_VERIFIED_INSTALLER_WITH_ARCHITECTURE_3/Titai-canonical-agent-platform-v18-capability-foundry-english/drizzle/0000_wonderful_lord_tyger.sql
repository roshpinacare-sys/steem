CREATE TABLE `agent_skills` (
	`agent_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`pinned_version_id` text,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pinned_version_id`) REFERENCES `skill_versions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_skills_pk` ON `agent_skills` (`agent_id`,`skill_id`);--> statement-breakpoint
CREATE TABLE `agent_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`version` integer NOT NULL,
	`system_prompt` text DEFAULT '' NOT NULL,
	`provider` text DEFAULT 'simulation' NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`temperature` real DEFAULT 0.7 NOT NULL,
	`max_steps` integer DEFAULT 8 NOT NULL,
	`max_tool_iterations` integer DEFAULT 6 NOT NULL,
	`tools` text DEFAULT '[]' NOT NULL,
	`created_at` integer,
	`created_by` text,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_versions_agent_version_uq` ON `agent_versions` (`agent_id`,`version`);--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`icon` text DEFAULT 'bot' NOT NULL,
	`tier` text DEFAULT 'engineering' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`current_version_id` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agents_owner_idx` ON `agents` (`owner_id`);--> statement-breakpoint
CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`step_id` text,
	`tool_call_id` text DEFAULT '' NOT NULL,
	`tool_name` text NOT NULL,
	`risk_level` text DEFAULT 'medium' NOT NULL,
	`request_payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reason` text,
	`resolved_by` text,
	`created_at` integer,
	`resolved_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`step_id`) REFERENCES `run_steps`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`resolved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `approvals_status_idx` ON `approvals` (`status`);--> statement-breakpoint
CREATE INDEX `approvals_run_idx` ON `approvals` (`run_id`);--> statement-breakpoint
CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`step_id` text,
	`name` text NOT NULL,
	`kind` text DEFAULT 'text' NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`step_id`) REFERENCES `run_steps`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `artifacts_run_idx` ON `artifacts` (`run_id`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`subject_type` text,
	`subject_id` text,
	`payload` text,
	`prev_hash` text NOT NULL,
	`hash` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `policies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`priority` integer DEFAULT 100 NOT NULL,
	`rules` text DEFAULT '[]' NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `provider_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`api_key_ciphertext` text,
	`api_key_iv` text,
	`api_key_tag` text,
	`api_key_mask` text,
	`base_url` text,
	`default_model` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_configs_user_provider_uq` ON `provider_configs` (`user_id`,`provider`);--> statement-breakpoint
CREATE TABLE `run_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`payload` text,
	`created_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `run_events_run_idx` ON `run_events` (`run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `run_events_run_seq_uq` ON `run_events` (`run_id`,`seq`);--> statement-breakpoint
CREATE TABLE `run_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`idx` integer NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`depends_on` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`output` text,
	`error` text,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `run_steps_run_idx` ON `run_steps` (`run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `run_steps_run_idx_uq` ON `run_steps` (`run_id`,`idx`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text,
	`agent_version_id` text,
	`agent_name` text DEFAULT '' NOT NULL,
	`agent_tier` text DEFAULT 'engineering' NOT NULL,
	`skill_version_ids` text DEFAULT '[]' NOT NULL,
	`user_id` text,
	`objective` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`provider` text DEFAULT 'simulation' NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`dry_run` integer DEFAULT false NOT NULL,
	`token_usage` text DEFAULT '{"input":0,"output":0}' NOT NULL,
	`error` text,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `runs_status_idx` ON `runs` (`status`);--> statement-breakpoint
CREATE INDEX `runs_agent_idx` ON `runs` (`agent_id`);--> statement-breakpoint
CREATE INDEX `runs_user_idx` ON `runs` (`user_id`);--> statement-breakpoint
CREATE TABLE `skill_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`skill_id` text NOT NULL,
	`version` integer NOT NULL,
	`frontmatter` text DEFAULT '{}' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`raw` text DEFAULT '' NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skill_versions_skill_version_uq` ON `skill_versions` (`skill_id`,`version`);--> statement-breakpoint
CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`current_version_id` text,
	`is_builtin` integer DEFAULT false NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skills_slug_unique` ON `skills` (`slug`);--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`icon` text DEFAULT 'sparkles' NOT NULL,
	`tier` text,
	`payload` text NOT NULL,
	`is_builtin` integer DEFAULT true NOT NULL,
	`created_at` integer
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`locale` text DEFAULT 'en' NOT NULL,
	`theme` text DEFAULT 'dark' NOT NULL,
	`created_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);