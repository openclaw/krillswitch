-- Idempotent local fixture: clawhub project, development/production environments,
-- eval keys, and a boolean `souls` flag (on in development, off in production).
-- INSERT OR IGNORE keeps local edits (e.g. toggled enabled state) across reruns.
-- One statement per line: tests execute this file line by line.
INSERT OR IGNORE INTO projects (id, key, name) VALUES ('proj_clawhub', 'clawhub', 'ClawHub');
INSERT OR IGNORE INTO environments (id, project_id, key, name) VALUES ('env_clawhub_dev', 'proj_clawhub', 'development', 'Development');
INSERT OR IGNORE INTO environments (id, project_id, key, name) VALUES ('env_clawhub_prod', 'proj_clawhub', 'production', 'Production');
INSERT OR IGNORE INTO eval_keys (id, environment_id, key) VALUES ('ek_clawhub_dev', 'env_clawhub_dev', 'ks_clawhub_development_local');
INSERT OR IGNORE INTO eval_keys (id, environment_id, key) VALUES ('ek_clawhub_prod', 'env_clawhub_prod', 'ks_clawhub_production_local');
INSERT OR IGNORE INTO flags (id, project_id, key, name, kind, description) VALUES ('flag_souls', 'proj_clawhub', 'souls', 'Souls', 'boolean', 'Gates the souls feature on ClawHub.');
INSERT OR IGNORE INTO variations (id, flag_id, value, name, sort_order) VALUES ('var_souls_on', 'flag_souls', 'true', 'On', 0);
INSERT OR IGNORE INTO variations (id, flag_id, value, name, sort_order) VALUES ('var_souls_off', 'flag_souls', 'false', 'Off', 1);
INSERT OR IGNORE INTO flag_environments (id, flag_id, environment_id, enabled, off_variation_id, default_variation_id, targets, rules, rollout) VALUES ('fe_souls_dev', 'flag_souls', 'env_clawhub_dev', 1, 'var_souls_off', 'var_souls_on', '[]', '[]', NULL);
INSERT OR IGNORE INTO flag_environments (id, flag_id, environment_id, enabled, off_variation_id, default_variation_id, targets, rules, rollout) VALUES ('fe_souls_prod', 'flag_souls', 'env_clawhub_prod', 0, 'var_souls_off', 'var_souls_on', '[]', '[]', NULL);
INSERT OR IGNORE INTO flags (id, project_id, key, name, kind, description) VALUES ('flag_theme', 'proj_clawhub', 'theme', 'Theme', 'string', 'Multivariate targeting fixture: allowlist pins system, role=admin gets dark, default light.');
INSERT OR IGNORE INTO variations (id, flag_id, value, name, sort_order) VALUES ('var_theme_light', 'flag_theme', '"light"', 'Light', 0);
INSERT OR IGNORE INTO variations (id, flag_id, value, name, sort_order) VALUES ('var_theme_dark', 'flag_theme', '"dark"', 'Dark', 1);
INSERT OR IGNORE INTO variations (id, flag_id, value, name, sort_order) VALUES ('var_theme_system', 'flag_theme', '"system"', 'System', 2);
INSERT OR IGNORE INTO flag_environments (id, flag_id, environment_id, enabled, off_variation_id, default_variation_id, targets, rules, rollout) VALUES ('fe_theme_dev', 'flag_theme', 'env_clawhub_dev', 1, 'var_theme_light', 'var_theme_light', '[{"variationId":"var_theme_system","contextKeys":["user-pinned"]}]', '[{"variationId":"var_theme_dark","attribute":"role","values":["admin"]}]', NULL);
INSERT OR IGNORE INTO flag_environments (id, flag_id, environment_id, enabled, off_variation_id, default_variation_id, targets, rules, rollout) VALUES ('fe_theme_prod', 'flag_theme', 'env_clawhub_prod', 0, 'var_theme_light', 'var_theme_light', '[]', '[]', NULL);
INSERT OR IGNORE INTO flags (id, project_id, key, name, kind, description) VALUES ('flag_rollout_demo', 'proj_clawhub', 'rollout-demo', 'Rollout Demo', 'string', 'Percentage rollout fixture: 50/50 weighted split in development.');
INSERT OR IGNORE INTO variations (id, flag_id, value, name, sort_order) VALUES ('var_rollout_a', 'flag_rollout_demo', '"a"', 'A', 0);
INSERT OR IGNORE INTO variations (id, flag_id, value, name, sort_order) VALUES ('var_rollout_b', 'flag_rollout_demo', '"b"', 'B', 1);
INSERT OR IGNORE INTO flag_environments (id, flag_id, environment_id, enabled, off_variation_id, default_variation_id, targets, rules, rollout) VALUES ('fe_rollout_demo_dev', 'flag_rollout_demo', 'env_clawhub_dev', 1, 'var_rollout_a', 'var_rollout_a', '[]', '[]', '{"variations":[{"variationId":"var_rollout_a","weight":50},{"variationId":"var_rollout_b","weight":50}]}');
INSERT OR IGNORE INTO flag_environments (id, flag_id, environment_id, enabled, off_variation_id, default_variation_id, targets, rules, rollout) VALUES ('fe_rollout_demo_prod', 'flag_rollout_demo', 'env_clawhub_prod', 0, 'var_rollout_a', 'var_rollout_a', '[]', '[]', NULL);
INSERT OR IGNORE INTO flags (id, project_id, key, name, kind, description) VALUES ('flag_longkey', 'proj_clawhub', 'checkout-experiments-2026-q3-progressive-disclosure-variant-rollout-long-tail', 'Checkout progressive disclosure rollout', 'boolean', 'Layout fixture: exercises long flag keys in the dashboard tables.');
INSERT OR IGNORE INTO variations (id, flag_id, value, name, sort_order) VALUES ('var_longkey_on', 'flag_longkey', 'true', 'On', 0);
INSERT OR IGNORE INTO variations (id, flag_id, value, name, sort_order) VALUES ('var_longkey_off', 'flag_longkey', 'false', 'Off', 1);
INSERT OR IGNORE INTO flag_environments (id, flag_id, environment_id, enabled, off_variation_id, default_variation_id, targets, rules, rollout) VALUES ('fe_longkey_dev', 'flag_longkey', 'env_clawhub_dev', 0, 'var_longkey_off', 'var_longkey_on', '[]', '[]', NULL);
INSERT OR IGNORE INTO flag_environments (id, flag_id, environment_id, enabled, off_variation_id, default_variation_id, targets, rules, rollout) VALUES ('fe_longkey_prod', 'flag_longkey', 'env_clawhub_prod', 0, 'var_longkey_off', 'var_longkey_on', '[]', '[]', NULL);
