CREATE TABLE `projects` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `path` text,
  `normalized_path` text,
  `kind` text NOT NULL,
  `is_system` integer NOT NULL DEFAULT false,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_normalized_path_unique` ON `projects` (`normalized_path`);
--> statement-breakpoint
CREATE INDEX `projects_kind_idx` ON `projects` (`kind`);
--> statement-breakpoint
INSERT INTO `projects` (`id`, `name`, `path`, `normalized_path`, `kind`, `is_system`, `created_at`, `updated_at`)
VALUES
  ('system:none', 'Bez projektu', NULL, NULL, 'none', 1, unixepoch() * 1000, unixepoch() * 1000),
  ('system:external', 'Zewnętrzne', NULL, NULL, 'external', 1, unixepoch() * 1000, unixepoch() * 1000),
  ('system:audit', 'Audyt', NULL, NULL, 'audit', 1, unixepoch() * 1000, unixepoch() * 1000),
  ('system:other', 'Inne', NULL, NULL, 'other', 1, unixepoch() * 1000, unixepoch() * 1000);
--> statement-breakpoint
ALTER TABLE `sessions` ADD COLUMN `project_id` text;
--> statement-breakpoint
WITH RECURSIVE ancestry(session_id, ancestor_id, depth) AS (
  SELECT id, id, 0
  FROM sessions
  UNION ALL
  SELECT ancestry.session_id, parent.id, ancestry.depth + 1
  FROM ancestry
  JOIN sessions current_session ON current_session.id = ancestry.ancestor_id
  JOIN sessions parent ON parent.id = current_session.parent_session_id
  WHERE current_session.parent_session_id IS NOT NULL
    AND ancestry.depth < 100
),
root_paths AS (
  SELECT ancestry.session_id,
    COALESCE(
      CASE WHEN json_valid(root.runtime_context) THEN json_extract(root.runtime_context, '$.architectureContext.projectPath') END,
      CASE WHEN json_valid(root.runtime_context) THEN json_extract(root.runtime_context, '$.architectureContext.executionCwd') END
    ) AS raw_path
  FROM ancestry
  JOIN sessions root ON root.id = ancestry.ancestor_id
  WHERE root.parent_session_id IS NULL
),
normalized_paths AS (
  SELECT session_id,
    raw_path,
    lower(rtrim(replace(raw_path, char(92), '/'), '/')) AS normalized_path
  FROM root_paths
  WHERE raw_path IS NOT NULL AND trim(raw_path) <> ''
)
INSERT OR IGNORE INTO projects (`id`, `name`, `path`, `normalized_path`, `kind`, `is_system`, `created_at`, `updated_at`)
SELECT 'legacy:' || normalized_path,
  raw_path,
  raw_path,
  normalized_path,
  'workspace',
  0,
  unixepoch() * 1000,
  unixepoch() * 1000
FROM normalized_paths
GROUP BY normalized_path;
--> statement-breakpoint
WITH RECURSIVE ancestry(session_id, ancestor_id, depth) AS (
  SELECT id, id, 0
  FROM sessions
  UNION ALL
  SELECT ancestry.session_id, parent.id, ancestry.depth + 1
  FROM ancestry
  JOIN sessions current_session ON current_session.id = ancestry.ancestor_id
  JOIN sessions parent ON parent.id = current_session.parent_session_id
  WHERE current_session.parent_session_id IS NOT NULL
    AND ancestry.depth < 100
),
root_paths AS (
  SELECT ancestry.session_id,
    COALESCE(
      CASE WHEN json_valid(root.runtime_context) THEN json_extract(root.runtime_context, '$.architectureContext.projectPath') END,
      CASE WHEN json_valid(root.runtime_context) THEN json_extract(root.runtime_context, '$.architectureContext.executionCwd') END
    ) AS raw_path
  FROM ancestry
  JOIN sessions root ON root.id = ancestry.ancestor_id
  WHERE root.parent_session_id IS NULL
),
normalized_paths AS (
  SELECT session_id,
    lower(rtrim(replace(raw_path, char(92), '/'), '/')) AS normalized_path
  FROM root_paths
  WHERE raw_path IS NOT NULL AND trim(raw_path) <> ''
)
UPDATE sessions
SET project_id = COALESCE(
  (SELECT 'legacy:' || normalized_paths.normalized_path
   FROM normalized_paths
   WHERE normalized_paths.session_id = sessions.id),
  'system:none'
);
--> statement-breakpoint
ALTER TABLE `messages` RENAME TO `messages_projects_legacy`;
--> statement-breakpoint
ALTER TABLE `sessions` RENAME TO `sessions_projects_legacy`;
--> statement-breakpoint
CREATE TABLE `sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `persona_id` text NOT NULL,
  `title` text NOT NULL DEFAULT '',
  `kind` text NOT NULL DEFAULT 'chat',
  `parent_session_id` text,
  `parent_turn_id` text,
  `parent_tool_call_id` text,
  `project_id` text NOT NULL REFERENCES `projects`(`id`),
  `runtime_context` text,
  `archived_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`persona_id`) REFERENCES `personas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `sessions` (`id`, `persona_id`, `title`, `kind`, `parent_session_id`, `parent_turn_id`, `parent_tool_call_id`, `project_id`, `runtime_context`, `archived_at`, `created_at`, `updated_at`)
SELECT `id`, `persona_id`, `title`, `kind`, `parent_session_id`, `parent_turn_id`, `parent_tool_call_id`, `project_id`, `runtime_context`, `archived_at`, `created_at`, `updated_at`
FROM `sessions_projects_legacy`;
--> statement-breakpoint
CREATE INDEX `sessions_project_id_updated_at_idx` ON `sessions` (`project_id`, `updated_at`);
--> statement-breakpoint
CREATE TABLE `messages` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL,
  `role` text NOT NULL,
  `content` text NOT NULL,
  `turn_id` text,
  `prompt_message_id` text,
  `thinking` text,
  `tool_calls` text,
  `tool_call_id` text,
  `attachments` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `messages` (`id`, `session_id`, `role`, `content`, `turn_id`, `prompt_message_id`, `thinking`, `tool_calls`, `tool_call_id`, `attachments`, `created_at`)
SELECT `id`, `session_id`, `role`, `content`, `turn_id`, `prompt_message_id`, `thinking`, `tool_calls`, `tool_call_id`, `attachments`, `created_at`
FROM `messages_projects_legacy`;
--> statement-breakpoint
DROP TABLE `messages_projects_legacy`;
--> statement-breakpoint
DROP TABLE `sessions_projects_legacy`;
