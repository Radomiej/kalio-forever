import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FinalAnswerCard, parseFinalAnswer } from './FinalAnswerCard';

const report = {
  status: 'accepted', blockingReason: null,
  evidence: ['Build passed\nTests passed'],
  answer: '## Verification\n\nBuild passed\nTests passed',
};

describe('structured final report display', () => {
  it('extracts the durable Finalizer heading before parsing JSON-encoded line breaks', () => {
    const content = `### Finalizer\n\n${JSON.stringify(report)}`;
    expect(parseFinalAnswer(content)).toMatchObject({ answer: report.answer, evidence: report.evidence });
    render(<FinalAnswerCard content={content} sessionId="host" />);
    expect(screen.getByRole('heading', { name: 'Verification' })).toBeVisible();
    expect(screen.getByText('Accepted')).toBeVisible();
    expect(screen.getByTestId('final-answer-evidence-row').textContent).not.toContain('\\n');
    expect(within(screen.getByTestId('final-answer-evidence-row')).getByText('Build passed Tests passed', { selector: 'p', exact: true })).toHaveClass('whitespace-pre-wrap');
  });

  it('retains actual newlines in decoded fields', () => {
    expect(parseFinalAnswer(JSON.stringify(report))?.answer).toBe(report.answer);
  });

  it('preserves Windows paths and intentional literal escapes in code after one JSON decode', () => {
    const answer = String.raw`Path: C:\new\notes.txt` + '\n\n```js\n' + String.raw`const separator = "\n";` + '\n```';
    const evidence = [String.raw`Read C:\new\notes.txt`];
    expect(parseFinalAnswer(`### Finalizer\n\n${JSON.stringify({ ...report, answer, evidence })}`))
      .toMatchObject({ answer, evidence });
  });

  it.each(['Normal text with a literal \\n and C:\\new', '{"status":"accepted",broken}',
    '### Other heading\n\n' + JSON.stringify(report), JSON.stringify({ arbitrary: 'data\nvalue' }),
    JSON.stringify(JSON.stringify(report)),
  ])('does not reinterpret unrelated, malformed or double-encoded content: %s', (content) => {
    expect(parseFinalAnswer(content)).toBeNull();
  });

  it('supports a JSON code fence inside the known Finalizer wrapper', () => {
    expect(parseFinalAnswer(`### Finalizer\n\n\`\`\`json\n${JSON.stringify(report)}\n\`\`\``))
      .toMatchObject({ answer: report.answer });
  });
});
