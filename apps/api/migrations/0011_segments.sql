CREATE TABLE `segments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL REFERENCES `projects`(`id`),
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`context_keys` text NOT NULL,
	`rules` text NOT NULL,
	`created_at` integer NOT NULL
);
CREATE UNIQUE INDEX `segments_project_key` ON `segments` (`project_id`,`key`);
