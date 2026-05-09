import type { GuiElementNode, GuiModule, GuiNode, GuiValue } from './guiDslAst';
import { parseGuiModule } from './guiDslModule';

export function compileGui(source: string): GuiNode[] {
  const mod = parseGuiModule(source);
  return expandGuiNodes(mod.roots, mod);
}

function expandGuiNodes(nodes: GuiNode[], mod: GuiModule): GuiNode[] {
  return nodes.map((n) => expandNode(n, mod));
}

function expandNode(node: GuiNode, mod: GuiModule): GuiNode {
  if (node.kind === 'block_node') {
    return { ...node, children: node.children.map((c) => expandNode(c, mod)) };
  }

  let out: GuiElementNode = node;
  const typeDef = mod.types[out.tag];
  if (typeDef) out = expandTypeInstance(out, typeDef, mod);
  out = applyTemplateUsing(out, mod);
  return { ...out, children: out.children.map((c) => expandNode(c, mod)) };
}

function applyTemplateUsing(node: GuiElementNode, mod: GuiModule): GuiElementNode {
  const usingValue = node.props.using;
  if (!usingValue) return node;
  const templateName = scalarToString(usingValue);
  if (!templateName) return node;
  const tpl = mod.templates[templateName];
  if (!tpl) return node;
  const fragment = blockToFragment(tpl.body, mod);
  const props = { ...fragment.props, ...node.props };
  delete (props as Record<string, GuiValue>)['using'];
  return { ...node, props, children: [...fragment.children, ...node.children] };
}

function expandTypeInstance(
  node: GuiElementNode,
  typeDef: { name: string; base: string; body: GuiModule['types'][string]['body'] },
  mod: GuiModule,
): GuiElementNode {
  const baseFragment = blockToFragment(typeDef.body, mod);
  const instanceBlockOverrides = new Map<string, { props: Record<string, GuiValue>; children: GuiNode[] }>();
  const instanceChildren: GuiNode[] = [];

  for (const c of node.children) {
    if (c.kind === 'block_node' && c.mode === 'blockoverride') {
      instanceBlockOverrides.set(c.name, { props: c.props, children: c.children });
    } else {
      instanceChildren.push(c);
    }
  }

  const mergedBaseChildren = applyBlockOverridesDeep(baseFragment.children, instanceBlockOverrides);
  return {
    kind: 'element',
    tag: typeDef.base,
    props: { ...baseFragment.props, ...node.props },
    children: [...mergedBaseChildren, ...instanceChildren],
  };
}

function applyBlockOverridesDeep(
  nodes: GuiNode[],
  overrides: Map<string, { props: Record<string, GuiValue>; children: GuiNode[] }>,
): GuiNode[] {
  return nodes.map((n) => {
    if (n.kind === 'block_node') {
      let out: GuiNode = n;
      if (n.mode === 'block') {
        const ov = overrides.get(n.name);
        if (ov) out = { ...n, props: { ...n.props, ...ov.props }, children: ov.children };
      }
      if (out.kind === 'block_node') {
        return { ...out, children: applyBlockOverridesDeep(out.children, overrides) };
      }
      return out;
    }
    if (n.kind === 'element') {
      return { ...n, children: applyBlockOverridesDeep(n.children, overrides) };
    }
    return n;
  });
}

function blockToFragment(
  block: GuiModule['types'][string]['body'],
  mod: GuiModule,
): { props: Record<string, GuiValue>; children: GuiNode[] } {
  const props: Record<string, GuiValue> = {};
  const children: GuiNode[] = [];

  if (!block || block.kind !== 'block') return { props, children };

  for (const item of block.items as Array<{ kind?: string; key?: string; value?: GuiValue; keyword?: string; name?: string | null; body?: GuiModule['types'][string]['body'] }>) {
    if (item?.kind === 'assign') {
      if (item.value?.kind === 'block' && item.key && isElementTag(item.key, mod)) {
        children.push(buildElementNode(item.key, item.value as GuiModule['types'][string]['body'], mod));
      } else if (item.key && item.value) {
        props[item.key] = item.value as GuiValue;
      }
      continue;
    }
    if (item?.kind === 'named_block') {
      const kw = String(item.keyword ?? '').toLowerCase();
      if ((kw === 'block' || kw === 'blockoverride') && item.body) {
        children.push(buildBlockNode(kw === 'block' ? 'block' : 'blockoverride', item.name ?? '', item.body, mod));
      }
      continue;
    }
  }

  return { props, children };
}

function buildElementNode(tag: string, block: GuiModule['types'][string]['body'], mod: GuiModule): GuiElementNode {
  const fragment = blockToFragment(block, mod);
  return { kind: 'element', tag, props: fragment.props, children: fragment.children };
}

function buildBlockNode(mode: 'block' | 'blockoverride', name: string, body: GuiModule['types'][string]['body'], mod: GuiModule): GuiNode {
  const fragment = blockToFragment(body, mod);
  return { kind: 'block_node', mode, name, props: fragment.props, children: fragment.children };
}

function isElementTag(tag: string, mod: GuiModule): boolean {
  const lower = tag.toLowerCase();
  const TAGS = new Set([
    'window', 'widget', 'container', 'hbox', 'vbox', 'div', 'span', 'img', 'icon',
    'label', 'textbox', 'button', 'progressbar', 'divider', 'spacer', 'list',
    'tooltipwidget', 'grid', 'scrollbox', 'anchor', 'input', 'select', 'textarea',
    'checkbox', 'radio', 'form', 'table', 'tr', 'td', 'th', 'card', 'badge',
    'modal', 'tooltip', 'tabs', 'tab',
  ]);
  if (TAGS.has(lower)) return true;
  if (tag in mod.types) return true;
  if (tag.length > 0 && tag[0] >= 'A' && tag[0] <= 'Z') return true;
  return false;
}

function scalarToString(v: GuiValue): string | null {
  if (!v || typeof v !== 'object') return null;
  if (v.kind === 'string') return v.value;
  if (v.kind === 'identifier') return v.value;
  return null;
}
