import type { Meta, StoryObj } from '@storybook/react-vite';
import { Badge } from '../Badge';

const meta = {
  title: 'UI/Badge',
  component: Badge,
  args: {
    label: 'Verified',
    variant: 'primary',
  },
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'accent', 'success', 'warning', 'error', 'ghost'],
    },
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {(['primary', 'secondary', 'accent', 'success', 'warning', 'error', 'ghost'] as const).map((variant) => (
        <Badge key={variant} label={variant} variant={variant} />
      ))}
    </div>
  ),
};
