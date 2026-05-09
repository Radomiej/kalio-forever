import type {
  GuiAssignStatement,
  GuiBlock,
  GuiBlockItem,
  GuiDocument,
  GuiModule,
  GuiNamedBlockStatement,
  GuiNode,
  GuiStatement,
  GuiTemplateDef,
  GuiTypeDef,
  GuiTypeDefStatement,
  GuiValue,
} from './guiDslAst';
import { parseGuiDocument } from './guiDslParser';

const KNOWN_TAGS = new Set([
  'window', 'widget', 'container', 'hbox', 'vbox', 'div', 'span', 'img', 'icon',
  'label', 'textbox', 'button', 'progressbar', 'divider', 'spacer', 'list',
  'tooltipwidget', 'grid', 'scrollbox', 'anchor', 'input', 'select', 'textarea',
  'checkbox', 'radio', 'form', 'table', 'tr', 'td', 'th', 'card', 'badge',
  'modal', 'tooltip', 'tabs', 'tab',
]);

const isUppercaseStart = (s: string) => s.length > 0 && s[0] >= 'A' && s[0] <= 'Z';

export function parseGuiModule(source: string): GuiModule {
  const doc = parseGuiDocument(source);
  const templates: Record<string, GuiTemplateDef> = {};
  const types: Record<string, GuiTypeDef> = {};
  const roots: GuiNode[] = [];

  for (const st of doc.items) {
    if (st.kind === 'named_block' && st.keyword.toLowerCase() === 'template' && st.name !== null) {
      templates[st.name] = { name: st.name, body: st.body };
      continue;
    }
    if (st.kind === 'named_block' && st.keyword.toLowerCase() === 'types') {
      collectTypes(types, st);
      continue;
    }
    const node = statementToRootNode(st, (tag) => isTag(tag, types));
    if (node) roots.push(node);
  }

  return { doc, templates, types, roots };
}

function collectTypes(out: Record<string, GuiTypeDef>, typesBlock: GuiNamedBlockStatement): void {
  for (const item of typesBlock.body.items) {
    if (typeof item !== 'object' || item === null) continue;
    if ((item as { kind?: string }).kind !== 'typedef') continue;
    const td = item as GuiTypeDefStatement;
    out[td.name] = { name: td.name, base: td.base, body: td.body };
  }
}

function isTag(tag: string, types: Record<string, GuiTypeDef>): boolean {
  if (KNOWN_TAGS.has(tag.toLowerCase())) return true;
  if (tag in types) return true;
  if (isUppercaseStart(tag)) return true;
  return false;
}

function statementToRootNode(st: GuiStatement, isElementTag: (tag: string) => boolean): GuiNode | null {
  if (st.kind === 'assign') {
    if (st.value.kind !== 'block') return null;
    return buildElementNode(st.key, st.value, isElementTag);
  }
  if (st.kind === 'named_block') {
    if (isElementTag(st.keyword)) {
      return buildElementNode(st.keyword, st.body, isElementTag);
    }
  }
  return null;
}

function buildElementNode(tag: string, block: GuiBlock, isElementTag: (tag: string) => boolean): GuiNode {
  const props: Record<string, GuiValue> = {};
  const children: GuiNode[] = [];

  for (const item of block.items) {
    if (isAssign(item)) {
      if (item.value.kind === 'block' && isElementTag(item.key)) {
        children.push(buildElementNode(item.key, item.value, isElementTag));
      } else {
        props[item.key] = item.value;
      }
      continue;
    }
    if (isNamedBlock(item)) {
      const kw = item.keyword.toLowerCase();
      if (kw === 'block' || kw === 'blockoverride') {
        children.push(buildBlockNode(kw === 'block' ? 'block' : 'blockoverride', item.name ?? '', item.body, isElementTag));
      } else if (isElementTag(item.keyword)) {
        children.push(buildElementNode(item.keyword, item.body, isElementTag));
      }
      continue;
    }
  }

  return { kind: 'element', tag, props, children };
}

function buildBlockNode(
  mode: 'block' | 'blockoverride',
  name: string,
  body: GuiBlock,
  isElementTag: (tag: string) => boolean,
): GuiNode {
  const props: Record<string, GuiValue> = {};
  const children: GuiNode[] = [];
  for (const item of body.items) {
    if (isAssign(item) && item.value.kind === 'block' && isElementTag(item.key)) {
      children.push(buildElementNode(item.key, item.value, isElementTag));
      continue;
    }
    if (isAssign(item)) {
      props[item.key] = item.value;
      continue;
    }
    if (isNamedBlock(item)) {
      const kw = item.keyword.toLowerCase();
      if (kw === 'block' || kw === 'blockoverride') {
        children.push(buildBlockNode(kw === 'block' ? 'block' : 'blockoverride', item.name ?? '', item.body, isElementTag));
      } else if (isElementTag(item.keyword)) {
        children.push(buildElementNode(item.keyword, item.body, isElementTag));
      }
      continue;
    }
  }
  return { kind: 'block_node', mode, name, props, children };
}

function isAssign(x: GuiBlockItem): x is GuiAssignStatement {
  return typeof x === 'object' && x !== null && (x as { kind?: string }).kind === 'assign';
}

function isNamedBlock(x: GuiBlockItem): x is GuiNamedBlockStatement {
  return typeof x === 'object' && x !== null && (x as { kind?: string }).kind === 'named_block';
}
