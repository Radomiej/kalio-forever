import type { GuiDslPayload, GuiNode } from '@kalio/types';

// Keep in sync with api/modules/raapp/qa-interactive-validation.ts for history/F5 payloads.
export function validateInteractiveQA({ nodes, data }: GuiDslPayload): string | null {
  const isQA = (items: GuiNode[]): boolean => items.some((node) =>
    (node.kind === 'element' && (node.props.id?.kind === 'identifier' || node.props.id?.kind === 'string')
      && node.props.id.value === 'qa_panel') || isQA(node.children));
  if (!isQA(nodes)) return null;
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
