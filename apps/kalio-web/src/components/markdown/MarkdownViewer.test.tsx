import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownViewer } from './MarkdownViewer';

describe('MarkdownViewer', () => {
  it('REGRESSION: renders raw tool_call XML as escaped transcript text', () => {
    render(
      <MarkdownViewer
        content={`Before\n<tool_call>\n<agentId>gemini</agentId>\n<parameters>{"workdir":"C:/repo"}</parameters>\n</tool_call>\nAfter`}
      />,
    );

    expect(screen.getByText(/<tool_call>/)).toBeInTheDocument();
    expect(screen.getByText(/<agentId>gemini<\/agentId>/)).toBeInTheDocument();
    expect(screen.getByText(/<parameters>/)).toBeInTheDocument();
    expect(document.querySelector('tool_call')).toBeNull();
    expect(document.querySelector('agentid')).toBeNull();
    expect(document.querySelector('parameters')).toBeNull();
  });

  it('REGRESSION: escapes an unterminated raw tool_call block while streaming', () => {
    render(
      <MarkdownViewer
        content={'<tool_call>\n<agentId>gemini</agentId>\n<prompt>Still streaming'}
      />,
    );

    expect(screen.getByText(/<tool_call>/)).toBeInTheDocument();
    expect(screen.getByText(/<agentId>gemini<\/agentId>/)).toBeInTheDocument();
    expect(screen.getByText(/<prompt>Still streaming/)).toBeInTheDocument();
    expect(document.querySelector('agentid')).toBeNull();
    expect(document.querySelector('prompt')).toBeNull();
  });

  it('renders markdown structures and code blocks with the expected wrappers', () => {
    const { container } = render(
      <MarkdownViewer
        content={`
# Overview

Visit [Kalio](https://example.com).

> Keep this line.

- First item
- Second item

| Name | Value |
| --- | --- |
| A | B |

<think>
Hidden reasoning
</think>

\`\`\`ts
const typed = true;
\`\`\`

\`\`\`
line one
line two
\`\`\`
`}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kalio' })).toHaveAttribute('href', 'https://example.com');
    expect(screen.getByRole('link', { name: 'Kalio' })).toHaveAttribute('target', '_blank');
    expect(screen.getByText('Keep this line.')).toBeInTheDocument();
    expect(screen.getByText('First item')).toBeInTheDocument();
    expect(screen.getByText('Second item')).toBeInTheDocument();
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Value')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('ts')).toBeInTheDocument();
    expect(screen.getByText('text')).toBeInTheDocument();
    const codeBlocks = container.querySelectorAll('pre code');
    expect(codeBlocks).toHaveLength(2);
    expect(codeBlocks[0]).toHaveTextContent('const typed = true;');
    expect(codeBlocks[1]).toHaveTextContent('line one');
    expect(codeBlocks[1]).toHaveTextContent('line two');
    expect(document.querySelector('details.think-block')).not.toBeNull();
    expect(document.querySelectorAll('button[title="Copy to clipboard"]')).toHaveLength(2);
  });

  it('uses the compact prose variant when requested', () => {
    const { container } = render(<MarkdownViewer content="Compact text" compact />);

    expect(container.firstChild).toHaveClass('prose-xs');
    expect(container.firstChild).toHaveClass('text-base-content/70');
  });
});
