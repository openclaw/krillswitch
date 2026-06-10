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
