import type { Meta, StoryObj } from '@storybook/react-vite';
import { Panel } from '../Panel';

const meta = {
  title: 'UI/Panel',
  component: Panel,
  args: {
    title: 'Execution summary',
    children: (
      <div className="space-y-2 p-4 text-sm text-base-content/75">
        <p>Goal, tool output, and review evidence stay grouped in a compact surface.</p>
        <div className="rounded-lg border border-base-300 bg-base-100 p-3 font-mono text-xs">
          status: verified
        </div>
      </div>
    ),
  },
} satisfies Meta<typeof Panel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
