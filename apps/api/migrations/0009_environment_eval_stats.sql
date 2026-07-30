ALTER TABLE `environments` ADD COLUMN `last_eval_at` integer;
ALTER TABLE `environments` ADD COLUMN `eval_count` integer NOT NULL DEFAULT 0;
