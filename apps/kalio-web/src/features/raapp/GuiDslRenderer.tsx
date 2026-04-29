import type {
  GuiValue, GuiElementNode, GuiBlockNode, GuiNode, GuiDslPayload,
} from '@kalio/types';

export type { GuiElementNode, GuiBlockNode, GuiNode, GuiDslPayload };

function scalarToString(v: GuiValue | undefined): string | null {
  if (!v) return null;
  if (v.kind === 'string')     return v.value;
  if (v.kind === 'identifier') return v.value;
  if (v.kind === 'number')     return String(v.value);
  if (v.kind === 'boolean')    return v.value ? 'yes' : 'no';
  return null;
}

function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((cur, k) =>
    cur !== null && cur !== undefined ? (cur as Record<string, unknown>)[k] : undefined, obj);
}

function resolveText(text: string, data: Record<string, unknown>): string {
  return text.replace(/\[([A-Za-z0-9_\-.]+)\]/g, (_m, key) => {
    const v = getByPath(data, key as string);
    return v !== null && v !== undefined ? String(v) : '';
  });
}

function resolveDynamicClass(raw: string, data: Record<string, unknown>): string {
  const qi = raw.indexOf('?');
  if (qi < 0) return '';
  const cond = resolveText(raw.slice(0, qi).trim(), data);
  const rest  = raw.slice(qi + 1);
  const lc    = rest.lastIndexOf(':');
  if (lc < 0) return '';
  const tcls = rest.slice(0, lc).trim();
  const fcls = rest.slice(lc + 1).trim();
  const m = cond.match(/^\s*(-?[\d.]+)\s*([><=!]+)\s*(-?[\d.]+)\s*$/);
  if (m) {
    const l = parseFloat(m[1]), op = m[2], r = parseFloat(m[3]);
    const res =
      op === '>'  ? l > r  : op === '<'  ? l < r  :
      op === '>=' || op === '=>' ? l >= r  :
      op === '<=' || op === '=<' ? l <= r  :
      op === '==' || op === '='  ? l === r :
      op === '!=' || op === '<>' ? l !== r : false;
    return res ? tcls : fcls;
  }
  return (cond && cond !== '0' && cond !== 'false' && cond !== 'no') ? tcls : fcls;
}

interface NodeViewProps {
  node: GuiNode;
  data: Record<string, unknown>;
  onAction?: (a: string) => void;
}

function NodeView({ node, data, onAction }: NodeViewProps) {
  if (node.kind === 'block_node') {
    return <>{node.children.map((c, i) => <NodeView key={i} node={c} data={data} onAction={onAction} />)}</>;
  }

  const p = node.props;
  const classRaw    = scalarToString(p.class) ?? '';
  const dynClassRaw = scalarToString(p.dynamic_class);
  const className   = dynClassRaw ? `${classRaw} ${resolveDynamicClass(dynClassRaw, data)}`.trim() : classRaw;
  const textRaw     = scalarToString(p.text);
  const text        = textRaw ? resolveText(textRaw, data) : null;
  const onClickRaw  = scalarToString(p.onclick);
  const visibleRaw  = scalarToString(p.visible);
  const disabledRaw = scalarToString(p.disabled);

  if (visibleRaw) {
    const res = resolveText(visibleRaw, data);
    const m = res.match(/^\s*(-?[\d.]+)\s*([><=!]+)\s*(-?[\d.]+)\s*$/);
    if (m) {
      const l = parseFloat(m[1]), op = m[2], r = parseFloat(m[3]);
      const show = op === '>' ? l > r : op === '<' ? l < r : op === '>=' || op === '=>' ? l >= r : op === '<=' || op === '=<' ? l <= r : op === '==' || op === '=' ? l === r : op === '!=' || op === '<>' ? l !== r : false;
      if (!show) return null;
    } else if (!res || res === '0' || res === 'false' || res === 'no') {
      return null;
    }
  }

  const isDisabled = disabledRaw ? (() => {
    const res = resolveText(disabledRaw, data);
    return res === '1' || res === 'true' || res === 'yes';
  })() : false;

  const onClick = onClickRaw ? () => onAction?.(resolveText(onClickRaw, data)) : undefined;
  const children = node.children.map((c, i) => <NodeView key={i} node={c} data={data} onAction={onAction} />);

  const tag = node.tag.toLowerCase();

  switch (tag) {
    case 'window':
    case 'container':
    case 'widget':
    case 'panel':
      return <div className={className || 'bg-base-200 rounded-lg p-3'} data-testid={`gui-${scalarToString(p.id) ?? tag}`}>{children}</div>;
    case 'vbox':
      return <div className={`flex flex-col ${className}`}>{children}</div>;
    case 'hbox':
      return <div className={`flex flex-row ${className}`}>{children}</div>;
    case 'label':
    case 'span':
      return <span className={className}>{text ?? children}</span>;
    case 'button':
      return (
        <button
          className={className || 'btn btn-sm btn-primary'}
          onClick={onClick}
          disabled={isDisabled}
          data-testid="gui-button"
        >
          {text ?? children}
        </button>
      );
    case 'divider':
      return <hr className={className || 'border-base-300 my-1'} />;
    case 'spacer':
      return <div className={className || 'flex-1'} />;
    case 'progressbar': {
      const valRaw  = scalarToString(p.value) ?? '0';
      const maxRaw  = scalarToString(p.max)   ?? '100';
      const valStr  = resolveText(valRaw, data);
      const maxStr  = resolveText(maxRaw, data);
      const valueNum = Number.parseFloat(valStr);
      const maxNum   = Number.parseFloat(maxStr);
      const safeMax  = Number.isFinite(maxNum) && maxNum > 0 ? maxNum : 100;
      const clamped  = Number.isFinite(valueNum) ? Math.min(safeMax, Math.max(0, valueNum)) : 0;
      return (
        <progress
          className={`progress progress-primary h-2 w-full ${className}`}
          value={clamped}
          max={safeMax}
          data-testid="gui-progressbar"
        />
      );
    }
    case 'div':
    default:
      return <div className={className}>{text ?? children}</div>;
  }
}

interface GuiDslRendererProps {
  payload: GuiDslPayload;
  onAction?: (action: string) => void;
}

export function GuiDslRenderer({ payload, onAction }: GuiDslRendererProps) {
  return (
    <div className="gui-dsl-root" data-testid="gui-dsl-renderer">
      {payload.nodes.map((node, i) => (
        <NodeView key={i} node={node} data={payload.data} onAction={onAction} />
      ))}
    </div>
  );
}
