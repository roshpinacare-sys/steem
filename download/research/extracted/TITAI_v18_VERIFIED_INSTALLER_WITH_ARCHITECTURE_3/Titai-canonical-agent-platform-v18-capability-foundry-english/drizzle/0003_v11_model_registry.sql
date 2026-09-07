CREATE TABLE `model_profiles` (
  `id` text PRIMARY KEY NOT NULL,
  `owner_id` text,
  `provider` text NOT NULL,
  `model` text NOT NULL,
  `display_name` text NOT NULL,
  `enabled` integer DEFAULT true NOT NULL,
  `is_builtin` integer DEFAULT false NOT NULL,
  `local` integer DEFAULT false NOT NULL,
  `license` text,
  `context_tokens` integer DEFAULT 32000 NOT NULL,
  `supports_tools` integer DEFAULT true NOT NULL,
  `supports_structured_output` integer DEFAULT true NOT NULL,
  `structured_output_reliability` real DEFAULT 0.5 NOT NULL,
  `tool_reliability` real DEFAULT 0.5 NOT NULL,
  `planning_quality` real DEFAULT 0.5 NOT NULL,
  `code_quality` real DEFAULT 0.5 NOT NULL,
  `availability` real DEFAULT 0.5 NOT NULL,
  `failure_rate` real DEFAULT 0.1 NOT NULL,
  `latency_ms` integer DEFAULT 5000 NOT NULL,
  `cost_per_million_input` real DEFAULT 0 NOT NULL,
  `cost_per_million_output` real DEFAULT 0 NOT NULL,
  `energy_wh_per_million_tokens` real DEFAULT 0 NOT NULL,
  `privacy_score` real DEFAULT 0.5 NOT NULL,
  `sovereignty_score` real DEFAULT 0.5 NOT NULL,
  `evaluation_confidence` real DEFAULT 0.2 NOT NULL,
  `artifact_hash` text,
  `evaluated_at` integer,
  `created_at` integer,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `model_profiles_owner_provider_model_uq` ON `model_profiles` (`owner_id`,`provider`,`model`);
--> statement-breakpoint
CREATE INDEX `model_profiles_owner_enabled_idx` ON `model_profiles` (`owner_id`,`enabled`);
