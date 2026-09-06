CREATE TABLE IF NOT EXISTS devices (
 endpoint TEXT PRIMARY KEY,
 uid TEXT NOT NULL,
 subscription TEXT NOT NULL,
 preferences TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 last_test INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS devices_uid ON devices(uid);
CREATE TABLE IF NOT EXISTS deliveries (
 event_key TEXT NOT NULL,
 endpoint TEXT NOT NULL,
 state TEXT NOT NULL,
 lease_until INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 PRIMARY KEY(event_key,endpoint)
);
CREATE INDEX IF NOT EXISTS deliveries_expiry ON deliveries(expires_at);
