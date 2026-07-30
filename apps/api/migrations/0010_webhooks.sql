CREATE TABLE `webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`enabled` integer NOT NULL DEFAULT 1,
	`cursor` integer NOT NULL DEFAULT 0,
	`last_status` text,
	`last_sent_at` integer,
	`created_at` integer NOT NULL
);
