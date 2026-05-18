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
});
