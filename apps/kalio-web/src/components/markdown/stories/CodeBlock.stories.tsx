import type { Meta, StoryObj } from '@storybook/react-vite';
import { CodeBlock } from '../CodeBlock';

const meta = {
  title: 'Markdown/CodeBlock',
  component: CodeBlock,
  args: {
    language: 'typescript',
    value: 'export const verified = true;\\nconsole.log({ verified });',
  },
} satisfies Meta<typeof CodeBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TypeScript: Story = {};

export const Shell: Story = {
  args: {
    language: 'powershell',
    value: 'corepack pnpm --filter kalio-web run build-storybook',
  },
};
