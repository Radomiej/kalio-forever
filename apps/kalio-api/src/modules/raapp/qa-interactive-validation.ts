import type { GuiNode } from './gui/guiDslAst';

// Keep in sync with the persisted-payload guard in web/features/raapp/qaInteractiveValidation.ts.
export function validateInteractiveQA(nodes: GuiNode[], data: Record<string, unknown>): string | null {
  const isQA = (items: GuiNode[]): boolean => items.some((node) =>
    (node.kind === 'element' && (node.props.id?.kind === 'identifier' || node.props.id?.kind === 'string')
      && node.props.id.value === 'qa_panel') || isQA(node.children));
  if (!isQA(nodes)) return null;
  const output = data.output;
  if (output === null || typeof output !== 'object' || Array.isArray(output)) {
    return 'Interactive Q&A requires a non-empty question and 1–5 non-empty string options. Generate them in the current conversation, then retry run_raapp with inputs.';
  }
  const values = output as Record<string, unknown>;
  const question = values.question;
  const options = values.options;
  const slots = Array.from({ length: 5 }, (_, index) => values[`option_${index}`]);
  const validText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
  const validOptions = Array.isArray(options)
    ? options.length > 0 && options.length <= 5 && options.every(validText)
      && options.every((option, index) => slots[index] === option)
    : slots.some(validText) && slots.every((slot) => slot === undefined || slot === '' || validText(slot));
  if (!validText(question) || !validOptions) {
    return 'Interactive Q&A requires a non-empty question and 1–5 non-empty string options. Generate them in the current conversation, then retry run_raapp with inputs.';
  }
  return null;
}
