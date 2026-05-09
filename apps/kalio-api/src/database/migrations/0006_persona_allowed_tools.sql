-- Rename the tool-allowlist column from 'skills' to 'allowed_tools'
-- and add 'skill_ids' for linking Skill entity IDs (prompt snippets).
ALTER TABLE personas RENAME COLUMN skills TO allowed_tools;
--> statement-breakpoint
ALTER TABLE personas ADD COLUMN skill_ids TEXT NOT NULL DEFAULT '[]';
