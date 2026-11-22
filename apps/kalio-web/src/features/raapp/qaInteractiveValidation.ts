import type { GuiDslPayload, GuiNode } from '@kalio/types';

function isQAPanel(node: GuiNode): boolean {
  return node.kind === 'element' && (node.props.id?.kind === 'identifier' || node.props.id?.kind === 'string')
    && node.props.id.value === 'qa_panel';
}

function hasQAPanel(nodes: GuiNode[]): boolean {
  return nodes.some((node) => isQAPanel(node) || hasQAPanel(node.children));
}

// Keep in sync with api/modules/raapp/qa-interactive-validation.ts for history/F5 payloads.
export function validateInteractiveQA({ nodes, data }: GuiDslPayload): string | null {
  if (!hasQAPanel(nodes)) return null;
  const output = data.output;
  if (output === null || typeof output !== 'object' || Array.isArray(output)) {
    return 'This Q&A has no question or answer options. Ask the agent to generate them and run the app again.';
  }
  const values = output as Record<string, unknown>;
  const validText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
  const slots = Array.from({ length: 5 }, (_, index) => values[`option_${index}`]);
  const options = values.options;
  const validOptions = Array.isArray(options)
    ? options.length > 0 && options.length <= 5 && options.every(validText)
      && options.every((option, index) => slots[index] === option)
    : slots.some(validText) && slots.every((slot) => slot === undefined || slot === '' || validText(slot));
  return validText(values.question) && validOptions ? null
    : 'This Q&A has no question or valid answer options. Ask the agent to generate them and run the app again.';
}

/** Project legacy Q&A visibility without changing saved nodes, answers or global DSL semantics. */
export function projectInteractiveQAOptionVisibility(payload: GuiDslPayload): GuiDslPayload {
  if (!hasQAPanel(payload.nodes)) return payload;
  const output = payload.data.output;
  if (!output || typeof output !== 'object' || Array.isArray(output)) return payload;
  const values = output as Record<string, unknown>;
  const project = (node: GuiNode, insideQA: boolean): GuiNode => {
    const withinQA = insideQA || isQAPanel(node);
    const children = node.children.map((child) => project(child, withinQA));
    if (node.kind !== 'element') return { ...node, children };
    const visible = node.props.visible;
    const match = withinQA && node.tag.toLowerCase() === 'button' && visible?.kind === 'string'
      ? /^\[output\.(option_[0-4])\]$/.exec(visible.value) : null;
    if (!match) return { ...node, children };
    const option = values[match[1]];
    return { ...node, children, props: { ...node.props,
      visible: { kind: 'boolean', value: typeof option === 'string' && option.trim().length > 0 },
    } };
  };
  return { ...payload, nodes: payload.nodes.map((node) => project(node, false)) };
}
