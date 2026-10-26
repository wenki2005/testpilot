ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
UPDATE users SET status = 'legacy' WHERE name = 'Lin';
