import { describe, expect, it } from 'vitest';
import type { ArchitectureChatRunSummary, ChatMessage } from '@kalio/types';
import { finalAnswerForArchitectureRun, parseFinalAnswer } from './finalAnswerReport';

const report = JSON.stringify({ status: 'accepted', blockingReason: null,
  evidence: ['Build passed', 'x'.repeat(900)], answer: '## Report\n\nFirst line\nSecond line' });
const run: ArchitectureChatRunSummary = { runId: 'run', schemaId: 'schema', status: 'completed', routeHops: [],
  trace: [{ speaker: 'finalizer', eventId: 'event', content: report.slice(0, 800) }] };
const message: ChatMessage = { id: 'architecture:run:text:event', sessionId: 'host', role: 'assistant',
  content: `### Finalizer\n\n${report}`, createdAt: 2 };

describe('final report selection', () => {
  it('uses the durable complete report over a clipped final artifact', () => {
    const content = finalAnswerForArchitectureRun({ ...run, finalArtifact: report.slice(0, 800) }, [message]);
    expect(content).toBe(message.content);
    expect(parseFinalAnswer(content!)?.answer).toBe('## Report\n\nFirst line\nSecond line');
  });
  it.each(['### Finalizer\n\n' + report.slice(0, 800), '{"status":"accepted",broken'.padEnd(800, ' ')])(
    'prefers a valid complete durable report over a malformed preview', (preview) => {
      expect(parseFinalAnswer(preview)).toBeNull();
      expect(finalAnswerForArchitectureRun({ ...run, finalArtifact: preview }, [message])).toBe(message.content);
    });
  it('preserves legacy plaintext when no complete durable report is available', () => {
    expect(finalAnswerForArchitectureRun({ ...run, finalArtifact: 'Legacy plain answer\nwith lines' }, []))
      .toBe('Legacy plain answer\nwith lines');
  });
  it('preserves the full authoritative artifact when present', () => {
    expect(finalAnswerForArchitectureRun({ ...run, finalArtifact: report }, [message]))
      .toBe(report);
  });
  it('does not borrow another run report and preserves the legacy preview when full data is absent', () => {
    expect(finalAnswerForArchitectureRun(run, [{ ...message, id: 'architecture:other:text:event' }])).toBe(report.slice(0, 800));
    expect(parseFinalAnswer(finalAnswerForArchitectureRun(run, [])!)?.partial).toBe(true);
  });
  it('does not treat an invalid durable wrapper as a structured report', () => {
    expect(finalAnswerForArchitectureRun(run, [{ ...message, content: '### Finalizer\n\n{broken' }])).toBe(report.slice(0, 800));
  });
});
