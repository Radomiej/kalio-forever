ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat';
--> statement-breakpoint
ALTER TABLE sessions ADD COLUMN parent_session_id TEXT;
--> statement-breakpoint
ALTER TABLE sessions ADD COLUMN parent_turn_id TEXT;
--> statement-breakpoint
ALTER TABLE sessions ADD COLUMN parent_tool_call_id TEXT;
--> statement-breakpoint
ALTER TABLE sessions ADD COLUMN interlocutor_label TEXT;