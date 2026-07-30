CREATE TABLE `eval_stats_daily` (
	`environment_id` text NOT NULL,
	`day` integer NOT NULL,
	`count` integer NOT NULL DEFAULT 0,
	PRIMARY KEY (`environment_id`, `day`)
);
