export function MCPSettingsPanel() {
  return (
    <div className="flex flex-col gap-4" data-testid="mcp-settings-panel">
      <div>
        <h2 className="text-base font-semibold mb-1">MCP Servers</h2>
        <p className="text-xs text-base-content/60">
          Model Context Protocol servers are configured via the sidebar MCP panel.
        </p>
      </div>
      <div className="alert alert-info text-xs py-2">
        Open the <strong>MCP</strong> tab in the sidebar to add or manage MCP server connections.
      </div>
    </div>
  );
}
