import type { Meta, StoryObj } from '@storybook/react-vite';
import { Spinner } from '../Spinner';

const meta = {
  title: 'UI/Spinner',
  component: Spinner,
  args: {
    size: 'md',
  },
  argTypes: {
    size: {
      control: 'select',
      options: ['xs', 'sm', 'md', 'lg'],
    },
  },
} satisfies Meta<typeof Spinner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      {(['xs', 'sm', 'md', 'lg'] as const).map((size) => (
        <Spinner key={size} size={size} />
      ))}
    </div>
  ),
};
