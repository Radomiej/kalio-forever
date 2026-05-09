-- Add mcp_policy column to personas table.
-- Default: 'allow_all' (existing personas keep unrestricted MCP access).
ALTER TABLE `personas` ADD COLUMN `mcp_policy` text NOT NULL DEFAULT 'allow_all';
