CREATE TABLE `change_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`actor_name` text NOT NULL,
	`action` text NOT NULL,
	`project_key` text,
	`flag_key` text,
	`target` text NOT NULL,
	`before` text,
	`after` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `change_log_created` ON `change_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `change_log_flag` ON `change_log` (`flag_key`);