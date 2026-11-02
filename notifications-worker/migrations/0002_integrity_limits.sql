CREATE TABLE IF NOT EXISTS integrity_limits (
 rate_key TEXT NOT NULL,
 bucket INTEGER NOT NULL,
 attempts INTEGER NOT NULL,
 PRIMARY KEY(rate_key,bucket)
);
CREATE INDEX IF NOT EXISTS integrity_limits_bucket ON integrity_limits(bucket);
