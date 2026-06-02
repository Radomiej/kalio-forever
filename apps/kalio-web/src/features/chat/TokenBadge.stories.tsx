import type { Meta, StoryObj } from '@storybook/react-vite';
import { TokenBadge } from './TokenBadge';
import type { TokenCount } from '../../services/tokenCounter';

function tokenCount(total: number, contextLimit: number): TokenCount {
  const usagePercent = Math.round((total / contextLimit) * 100);
  return {
    total,
    contextLimit,
    usagePercent,
    cacheable: Math.round(total * 0.24),
    breakdown: {
      systemPrompt: Math.round(total * 0.08),
      skills: Math.round(total * 0.04),
      tools: Math.round(total * 0.12),
      history: Math.round(total * 0.72),
      images: Math.round(total * 0.04),
    },
  };
}

const meta = {
  title: 'Chat/TokenBadge',
  component: TokenBadge,
  args: {
    tokenCount: tokenCount(18_400, 128_000),
  },
} satisfies Meta<typeof TokenBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Normal: Story = {};

export const Warning: Story = {
  args: {
    tokenCount: tokenCount(104_000, 128_000),
  },
};

export const Critical: Story = {
  args: {
    tokenCount: tokenCount(124_500, 128_000),
  },
};
