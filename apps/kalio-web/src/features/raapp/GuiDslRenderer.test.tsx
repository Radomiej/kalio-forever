import { describe, it, expect } from 'vitest';
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
});
