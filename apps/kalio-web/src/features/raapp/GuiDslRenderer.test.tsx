import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GuiDslRenderer, type GuiDslPayload } from './GuiDslRenderer';

function makePayload(nodes: GuiDslPayload['nodes'], data: Record<string, unknown> = {}): GuiDslPayload {
  return { nodes, data };
}

describe('GuiDslRenderer', () => {
  it('renders root container with data-testid', () => {
    render(<GuiDslRenderer payload={makePayload([])} />);
    expect(screen.getByTestId('gui-dsl-renderer')).toBeInTheDocument();
  });

  it('renders a label with static text', () => {
    const payload = makePayload([
      { kind: 'element', tag: 'label', props: { text: { kind: 'string', value: 'Hello World' } }, children: [] },
    ]);
    render(<GuiDslRenderer payload={payload} />);
    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  it('resolves [binding] in label text from data', () => {
    const payload = makePayload(
      [{ kind: 'element', tag: 'label', props: { text: { kind: 'string', value: 'Score: [score]' } }, children: [] }],
      { score: 42 },
    );
    render(<GuiDslRenderer payload={payload} />);
    expect(screen.getByText('Score: 42')).toBeInTheDocument();
  });

  it('renders vbox as flex-col div', () => {
    const { container } = render(
      <GuiDslRenderer payload={makePayload([
        { kind: 'element', tag: 'vbox', props: {}, children: [] },
      ])} />,
    );
    const div = container.querySelector('.flex.flex-col');
    expect(div).toBeTruthy();
  });

  it('renders hbox as flex-row div', () => {
    const { container } = render(
      <GuiDslRenderer payload={makePayload([
        { kind: 'element', tag: 'hbox', props: {}, children: [] },
      ])} />,
    );
    const div = container.querySelector('.flex.flex-row');
    expect(div).toBeTruthy();
  });

  it('renders button with text and data-testid', () => {
    const payload = makePayload([
      { kind: 'element', tag: 'button', props: { text: { kind: 'string', value: 'Click me' } }, children: [] },
    ]);
    render(<GuiDslRenderer payload={payload} />);
    expect(screen.getByTestId('gui-button')).toBeInTheDocument();
    expect(screen.getByText('Click me')).toBeInTheDocument();
  });

  it('hides element when visible binding resolves to falsy', () => {
    const payload = makePayload(
      [{ kind: 'element', tag: 'label', props: {
        text: { kind: 'string', value: 'Hidden' },
        visible: { kind: 'string', value: '[show]' },
      }, children: [] }],
      { show: 0 },
    );
    render(<GuiDslRenderer payload={payload} />);
    expect(screen.queryByText('Hidden')).toBeNull();
  });

  it('renders block_node children inline', () => {
    const payload = makePayload([{
      kind: 'block_node',
      mode: 'block',
      name: 'test',
      props: {},
      children: [
        { kind: 'element', tag: 'label', props: { text: { kind: 'string', value: 'In block' } }, children: [] },
      ],
    }]);
    render(<GuiDslRenderer payload={payload} />);
    expect(screen.getByText('In block')).toBeInTheDocument();
  });

  it('renders progressbar with data-testid', () => {
    const payload = makePayload([
      { kind: 'element', tag: 'progressbar', props: {
        value: { kind: 'number', value: 50 },
        max: { kind: 'number', value: 100 },
      }, children: [] },
    ]);
    render(<GuiDslRenderer payload={payload} />);
    expect(screen.getByTestId('gui-progressbar')).toBeInTheDocument();
  });

  it('renders icon element with data-testid and name text', () => {
    const payload = makePayload([
      { kind: 'element', tag: 'icon', props: { name: { kind: 'string', value: 'star' } }, children: [] },
    ]);
    render(<GuiDslRenderer payload={payload} />);
    const icon = screen.getByTestId('gui-icon');
    expect(icon).toBeInTheDocument();
    expect(icon.textContent).toBe('star');
  });

  it('renders icon element with identifier name prop', () => {
    const payload = makePayload([
      { kind: 'element', tag: 'icon', props: { name: { kind: 'identifier', value: 'check' } }, children: [] },
    ]);
    render(<GuiDslRenderer payload={payload} />);
    expect(screen.getByTestId('gui-icon').textContent).toBe('check');
  });

  it('renders supported layout tags, scalar values, and fallback nodes', () => {
    const payload = makePayload([
      { kind: 'element', tag: 'window', props: { id: { kind: 'string', value: 'window' } }, children: [] },
      { kind: 'element', tag: 'container', props: { id: { kind: 'string', value: 'container' } }, children: [] },
      { kind: 'element', tag: 'widget', props: { id: { kind: 'string', value: 'widget' } }, children: [] },
      { kind: 'element', tag: 'panel', props: { id: { kind: 'string', value: 'panel' } }, children: [] },
      { kind: 'element', tag: 'span', props: { text: { kind: 'identifier', value: 'identifier-text' } }, children: [] },
      { kind: 'element', tag: 'label', props: { text: { kind: 'number', value: 7 } }, children: [] },
      { kind: 'element', tag: 'label', props: { text: { kind: 'boolean', value: true } }, children: [] },
      { kind: 'element', tag: 'divider', props: {}, children: [] },
      { kind: 'element', tag: 'spacer', props: {}, children: [] },
      { kind: 'element', tag: 'unknown', props: { text: { kind: 'string', value: 'fallback' } }, children: [] },
    ]);

    const { container } = render(<GuiDslRenderer payload={payload} />);

    expect(screen.getByTestId('gui-window')).toBeInTheDocument();
    expect(screen.getByTestId('gui-container')).toBeInTheDocument();
    expect(screen.getByTestId('gui-widget')).toBeInTheDocument();
    expect(screen.getByTestId('gui-panel')).toBeInTheDocument();
    expect(screen.getByText('identifier-text')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('yes')).toBeInTheDocument();
    expect(container.querySelector('hr')).toBeInTheDocument();
    expect(container.querySelector('.flex-1')).toBeInTheDocument();
    expect(screen.getByText('fallback')).toBeInTheDocument();
  });

  it('evaluates numeric and boolean visibility expressions', () => {
    const comparisons = ['1 > 0', '1 < 2', '2 >= 2', '2 <= 2', '2 == 2', '2 != 3'];
    const nodes = comparisons.map((visible, index) => ({
      kind: 'element' as const,
      tag: 'label',
      props: {
        text: { kind: 'string' as const, value: `visible-${index}` },
        visible: { kind: 'string' as const, value: visible },
      },
      children: [],
    }));
    nodes.push(
      { kind: 'element', tag: 'label', props: { text: { kind: 'string', value: 'truthy' }, visible: { kind: 'string', value: 'yes' } }, children: [] },
      { kind: 'element', tag: 'label', props: { text: { kind: 'string', value: 'hidden-false' }, visible: { kind: 'string', value: 'false' } }, children: [] },
      { kind: 'element', tag: 'label', props: { text: { kind: 'string', value: 'hidden-empty' }, visible: { kind: 'string', value: '[missing]' } }, children: [] },
    );

    render(<GuiDslRenderer payload={makePayload(nodes)} />);

    for (let index = 0; index < comparisons.length; index += 1) {
      expect(screen.getByText(`visible-${index}`)).toBeInTheDocument();
    }
    expect(screen.getByText('truthy')).toBeInTheDocument();
    expect(screen.queryByText('hidden-false')).toBeNull();
    expect(screen.queryByText('hidden-empty')).toBeNull();
  });

  it('resolves dynamic classes for numeric operators and truthy values', () => {
    const nodes = [
      ['2 > 1', 'gt'], ['1 < 2', 'lt'], ['2 >= 2', 'gte'], ['2 <= 2', 'lte'],
      ['2 == 2', 'eq'], ['2 != 3', 'neq'], ['yes', 'truthy'], ['false', 'falsy'],
    ].map(([expression, id]) => ({
      kind: 'element' as const,
      tag: 'label',
      props: {
        id: { kind: 'string' as const, value: id },
        text: { kind: 'string' as const, value: id },
        dynamic_class: { kind: 'string' as const, value: `${expression} ? active:inactive` },
      },
      children: [],
    }));

    const { container } = render(<GuiDslRenderer payload={makePayload(nodes)} />);

    expect(container.querySelectorAll('.active')).toHaveLength(7);
    expect(container.querySelectorAll('.inactive')).toHaveLength(1);
  });

  it('binds button actions and disabled state to resolved data', () => {
    const onAction = vi.fn();
    const payload = makePayload([
      {
        kind: 'element',
        tag: 'button',
        props: {
          text: { kind: 'string', value: 'Run [name]' },
          onclick: { kind: 'string', value: 'run:[name]' },
          disabled: { kind: 'string', value: '[disabled]' },
        },
        children: [],
      },
    ], { name: 'demo', disabled: false });

    render(<GuiDslRenderer payload={payload} onAction={onAction} />);
    const button = screen.getByTestId('gui-button');
    expect(button).not.toBeDisabled();
    button.click();
    expect(onAction).toHaveBeenCalledWith('run:demo');

    const disabledPayload = makePayload([
      { kind: 'element', tag: 'button', props: { text: { kind: 'string', value: 'Disabled' }, disabled: { kind: 'string', value: 'yes' } }, children: [] },
    ]);
    render(<GuiDslRenderer payload={disabledPayload} />);
    expect(screen.getByText('Disabled')).toBeDisabled();
  });

  it('clamps invalid progressbar values and supports text bindings', () => {
    const payload = makePayload([
      { kind: 'element', tag: 'progressbar', props: { value: { kind: 'string', value: '[value]' }, max: { kind: 'string', value: '[max]' } }, children: [] },
      { kind: 'element', tag: 'progressbar', props: { value: { kind: 'string', value: 'invalid' }, max: { kind: 'number', value: 0 } }, children: [] },
    ], { value: 150, max: 100 });

    render(<GuiDslRenderer payload={payload} />);
    const progressbars = screen.getAllByTestId('gui-progressbar');
    expect(progressbars[0]).toHaveAttribute('value', '100');
    expect(progressbars[0]).toHaveAttribute('max', '100');
    expect(progressbars[1]).toHaveAttribute('value', '0');
    expect(progressbars[1]).toHaveAttribute('max', '100');
  });
});
