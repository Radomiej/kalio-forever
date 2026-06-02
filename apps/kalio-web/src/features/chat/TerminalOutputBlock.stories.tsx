import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { TerminalOutputBlock } from './TerminalOutputBlock';

const successResult = {
  agentId: 'codex',
  output: [
    '> corepack pnpm --filter kalio-demo run build',
    'vite v6.4.2 building for production...',
    '✓ 1634 modules transformed.',
    '✓ built in 2.89s',
  ].join('\n'),
  exitCode: 0,
  durationMs: 2890,
};

function CollapsibleTerminalOutput(args: React.ComponentProps<typeof TerminalOutputBlock>) {
  const [expanded, setExpanded] = useState(false);
  return <TerminalOutputBlock {...args} isExpanded={expanded} onToggle={() => setExpanded((value) => !value)} />;
}

const meta = {
  title: 'Chat/TerminalOutputBlock',
  component: TerminalOutputBlock,
  args: {
    agentId: 'codex',
    result: successResult,
    isExpanded: true,
    onToggle: () => undefined,
  },
} satisfies Meta<typeof TerminalOutputBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Expanded: Story = {
  render: (args) => <TerminalOutputBlock {...args} isExpanded onToggle={() => undefined} />,
};

export const Collapsible: Story = {
  args: {
    isExpanded: false,
    onToggle: () => undefined,
  },
  render: (args) => <CollapsibleTerminalOutput {...args} />,
};

export const Failed: Story = {
  args: {
    isExpanded: true,
    onToggle: () => undefined,
    result: {
      agentId: 'codex',
      output: 'Error: missing verification evidence',
      exitCode: 1,
      durationMs: 840,
    },
  },
  render: (args) => <TerminalOutputBlock {...args} isExpanded onToggle={() => undefined} />,
};
