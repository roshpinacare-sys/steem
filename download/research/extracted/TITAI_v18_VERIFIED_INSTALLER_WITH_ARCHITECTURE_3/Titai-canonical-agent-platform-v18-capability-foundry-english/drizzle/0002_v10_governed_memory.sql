CREATE TABLE `memories` (
  `id` text PRIMARY KEY NOT NULL,
  `owner_id` text NOT NULL,
  `kind` text NOT NULL,
  `content` text NOT NULL,
  `content_hash` text NOT NULL,
  `tags` text DEFAULT '[]' NOT NULL,
  `provenance` text NOT NULL,
  `confidence` real DEFAULT 0.5 NOT NULL,
  `authority` real DEFAULT 0.5 NOT NULL,
  `contradiction_risk` real DEFAULT 0 NOT NULL,
  `sensitivity` text DEFAULT 'internal' NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `corrects_id` text,
  `contradiction_group` text,
  `expires_at` integer,
  `created_at` integer,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE cascade,
  FOREIGN KEY (`corrects_id`) REFERENCES `memories`(`id`) ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `memories_owner_status_idx` ON `memories` (`owner_id`,`status`);
--> statement-breakpoint
CREATE INDEX `memories_owner_kind_idx` ON `memories` (`owner_id`,`kind`);
--> statement-breakpoint
CREATE INDEX `memories_expires_idx` ON `memories` (`expires_at`);
--> statement-breakpoint
CREATE INDEX `memories_correction_idx` ON `memories` (`corrects_id`);
