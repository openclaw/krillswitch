-- Existing subscribers keep HTTP and checked redirect delivery until URL replacement.
ALTER TABLE webhooks ADD COLUMN strict_delivery integer NOT NULL DEFAULT 0;
