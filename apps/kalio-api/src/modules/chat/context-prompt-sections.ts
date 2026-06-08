import type { Skill, ToolMeta } from '@kalio/types';

export function buildSkillsSection(skills: Array<Pick<Skill, 'name' | 'description' | 'prompt'>>): string {
  if (skills.length === 0) {
    return '';
  }
  return '\n\n## Active skills\n' + skills.map((skill) =>
    `### ${skill.name}\n${skill.description}\n\n${skill.prompt}`,
  ).join('\n\n');
}

export function buildToolsSection(
  toolMetas: ToolMeta[],
  options?: { compact?: boolean; includeCount?: boolean },
): string {
  if (toolMetas.length === 0) {
    return '\n\n## Available tools\nNo tools are available in this run. Do not emit XML tool calls, `<tool_call>` blocks, function-call markup, or requests to use tools. Return a plain-language final answer only.';
  }

  const heading = options?.includeCount === false
    ? '\n\n## Available tools\n'
    : `\n\n## Available tools (${toolMetas.length})\n`;

  return heading + toolMetas.map((tool) => {
    const desc = tool.description.length > 80
      ? `${tool.description.slice(0, 79)}...`
      : tool.description;
    const approval = options?.compact && tool.requiresConfirmation ? ' Requires approval.' : '';
    return `- ${tool.name}: ${desc}${approval}`;
  }).join('\n');
}
