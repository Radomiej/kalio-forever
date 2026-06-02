import type { Meta, StoryObj } from '@storybook/react-vite';
import { MarkdownViewer } from '../MarkdownViewer';

const meta = {
  title: 'Markdown/MarkdownViewer',
  component: MarkdownViewer,
  args: {
    content: [
      '## Verified result',
      '',
      '- Tool call completed',
      '- Evidence attached',
      '',
      '```ts',
      'const status = "verified";',
      '```',
    ].join('\n'),
  },
} satisfies Meta<typeof MarkdownViewer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Compact: Story = {
  args: {
    compact: true,
  },
};
