import type { Meta, StoryObj } from '@storybook/react-vite';
import { AppTile } from './AppTile';

const meta = {
  title: 'Landing/AppTile',
  component: AppTile,
  args: {
    id: 'chat',
    name: 'Chat',
    description: 'Conversational interface',
    size: 'small',
    index: 0,
    onClick: () => undefined,
  },
  argTypes: {
    size: {
      control: 'select',
      options: ['small', 'wide'],
    },
  },
} satisfies Meta<typeof AppTile>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Small: Story = {
  decorators: [
    (Story) => (
      <div className="grid w-56 grid-cols-1">
        <Story />
      </div>
    ),
  ],
};

export const Wide: Story = {
  args: {
    id: 'workflows',
    name: 'Workflows',
    description: 'Design and run agent flows',
    size: 'wide',
  },
  decorators: [
    (Story) => (
      <div className="grid w-[28rem] grid-cols-2">
        <Story />
      </div>
    ),
  ],
};

export const GeneratingIcon: Story = {
  args: {
    id: 'tools',
    name: 'Tools',
    description: 'Integrations and tool calls',
    isGenerating: true,
    onGenerateIcon: () => undefined,
  },
  decorators: [
    (Story) => (
      <div className="grid w-56 grid-cols-1">
        <Story />
      </div>
    ),
  ],
};
