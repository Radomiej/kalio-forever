-- Drop agent loop tables (feature removed — was a stub with no implementation)
DROP TABLE IF EXISTS `agent_iterations`;
DROP TABLE IF EXISTS `agent_tasks`;
DROP TABLE IF EXISTS `agent_loops`;

-- Add tool_overrides table for user-configurable requiresConfirmation per tool
CREATE TABLE IF NOT EXISTS `tool_overrides` (
  `tool_name` text PRIMARY KEY NOT NULL,
  `requires_confirmation` integer NOT NULL,
  `updated_at` integer NOT NULL
);
