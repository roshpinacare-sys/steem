ALTER TABLE `artifacts` ADD `idempotency_key` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `artifacts_run_idempotency_uq` ON `artifacts` (`run_id`,`idempotency_key`);
