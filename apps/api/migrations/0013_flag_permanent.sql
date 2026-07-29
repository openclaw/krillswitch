-- Lifecycle marking: permanent flags (config knobs, kill switches) are
-- exempt from staleness reporting; everything else is temporary rollout
-- scaffolding that should eventually leave the codebase.
ALTER TABLE flags ADD COLUMN permanent INTEGER NOT NULL DEFAULT 0;
