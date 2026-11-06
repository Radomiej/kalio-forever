import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FinalAnswerCard, parseFinalAnswer } from './FinalAnswerCard';
import { WorkflowTraceCard } from './WorkflowTraceCard';

describe('workflow final answer', () => {
  it('separates fields from a saved router summary and keeps a zero count', () => {
    render(<WorkflowTraceCard trace={{ kind: 'router', from: 'agent', to: 'qa',
      body: 'Orchestrator handed off to QA. Confidence: 88%. Accepted inputs: 4; rejected inputs: 0. Decision: Run the build.' }} />);
    const fields = screen.getByTestId('router-decision-fields');
    expect(fields).toHaveTextContent('Confidence88%');
    expect(fields).toHaveTextContent('Rejected inputs0');
    expect(screen.getByText('Run the build.')).toBeVisible();
  });
  it('shows accepted status and evidence without empty blocking information', () => {
    render(<FinalAnswerCard sessionId="session" content={JSON.stringify({
      status: 'accepted', blockingReason: null, evidence: ['Build passed'], answer: 'Ready to review.',
    })} />);
    expect(screen.getByText('Accepted')).toBeVisible();
    expect(screen.getByText('Build passed')).toBeVisible();
    expect(screen.queryByText('Blocking reason')).not.toBeInTheDocument();
  });

  it('shows a blocking reason for an incomplete result', () => {
    render(<FinalAnswerCard sessionId="session" content={JSON.stringify({
      status: 'incomplete', blockingReason: 'Build required', evidence: [],
    })} />);
    expect(screen.getByText('Build required')).toBeVisible();
  });

  it('keeps only complete evidence from an old clipped artifact', () => {
    const clipped = JSON.stringify({
      status: 'accepted', blockingReason: null, evidence: ['Read "src/App.jsx"', 'a'.repeat(1000)],
    }).slice(0, 800);
    expect(parseFinalAnswer(clipped)).toEqual({
      status: 'accepted', blockingReason: undefined, evidence: ['Read "src/App.jsx"'], partial: true,
    });
    expect(parseFinalAnswer('{"status":"accepted"}')).toBeNull();
  });
});
