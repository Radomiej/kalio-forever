import type { Meta, StoryObj } from '@storybook/react-vite';
import { FriendlyId } from '../FriendlyId';

const meta = {
  title: 'UI/FriendlyId',
  component: FriendlyId,
  args: {
    id: 'session_01HX9ZKALIOFOREVERDEMO',
    context: 'Session',
  },
} satisfies Meta<typeof FriendlyId>;

export default meta;
type Story = StoryObj<typeof meta>;

export const GeneratedAlias: Story = {};

export const ResolvedTitle: Story = {
  args: {
    resolvedTitle: 'Public demo session',
  },
};
