ALTER TABLE `runs` ADD `runner_mode` text DEFAULT 'legacy' NOT NULL;
--> statement-breakpoint
ALTER TABLE `runs` ADD `routing_decision` text;
--> statement-breakpoint
ALTER TABLE `runs` ADD `memory_snapshot` text DEFAULT '[]' NOT NULL;
