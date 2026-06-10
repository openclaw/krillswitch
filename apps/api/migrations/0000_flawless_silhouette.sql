CREATE TABLE `environments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `environments_project_key` ON `environments` (`project_id`,`key`);--> statement-breakpoint
CREATE TABLE `eval_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`environment_id` text NOT NULL,
	`key` text NOT NULL,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `eval_keys_key_unique` ON `eval_keys` (`key`);--> statement-breakpoint
CREATE TABLE `flag_environments` (
	`id` text PRIMARY KEY NOT NULL,
	`flag_id` text NOT NULL,
	`environment_id` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`off_variation_id` text NOT NULL,
	`default_variation_id` text NOT NULL,
	`targets` text DEFAULT '[]' NOT NULL,
	`rules` text DEFAULT '[]' NOT NULL,
	`rollout` text,
	FOREIGN KEY (`flag_id`) REFERENCES `flags`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `flag_environments_flag_environment` ON `flag_environments` (`flag_id`,`environment_id`);--> statement-breakpoint
CREATE TABLE `flags` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`description` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `flags_project_key` ON `flags` (`project_id`,`key`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_key_unique` ON `projects` (`key`);--> statement-breakpoint
CREATE TABLE `variations` (
	`id` text PRIMARY KEY NOT NULL,
	`flag_id` text NOT NULL,
	`value` text NOT NULL,
	`name` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`flag_id`) REFERENCES `flags`(`id`) ON UPDATE no action ON DELETE no action
);
