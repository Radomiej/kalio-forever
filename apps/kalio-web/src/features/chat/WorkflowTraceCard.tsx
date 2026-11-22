import { CircleCheck, CircleMinus, Gauge, GitBranch, Route, Workflow } from 'lucide-react';
import type { ArchitectureChatTraceStep } from '@kalio/types';
import { MarkdownViewer } from '../../components/markdown/MarkdownViewer';

export function readWorkflowTrace(content: string) {
  const header = /^### (Router|Finalizer)\r?\n(?:\r?\n)?/.exec(content);
  if (!header) return null;
  const body = content.slice(header[0].length);
  const route = /^Route: ([^\r\n]+) -> ([^\r\n]+)\r?\n(?:\r?\n)?/.exec(body);
  return {
    kind: header[1] === 'Router' ? 'router' as const : 'finalizer' as const,
    from: route?.[1],
    to: route?.[2],
    body: route ? body.slice(route[0].length) : body,
  };
}

export function WorkflowTraceCard({ trace, output }: {
  trace: NonNullable<ReturnType<typeof readWorkflowTrace>>;
  output?: ArchitectureChatTraceStep['routerOutput'];
}) {
  const router = trace.kind === 'router';
  const Icon = router ? GitBranch : Workflow;
  // TODO: legacy fallback — some saved router steps only retain the generated text summary.
  const legacy = router && !output
    ? /^([^\r\n]{0,240}?)\bConfidence:\s*(100|\d{1,2})%\.\s*Accepted inputs:\s*(\d+);\s*rejected inputs:\s*(\d+)\.(?:\s*Decision:\s*)?/i.exec(trace.body)
    : null;
  const confidence = output ? Math.round(output.confidence * 100) : legacy?.[2];
  const accepted = output?.acceptedInputs.length ?? legacy?.[3];
  const rejected = output?.rejectedInputs.length ?? legacy?.[4];
  const fields = [
    { label: 'Confidence', value: confidence === undefined ? undefined : `${confidence}%`, icon: Gauge },
    { label: 'Next action', value: output?.nextAction.replaceAll('_', ' '), icon: Route },
    { label: 'Accepted inputs', value: accepted, icon: CircleCheck },
    { label: 'Rejected inputs', value: rejected, icon: CircleMinus },
  ];
  const body = output?.mergedDecision || (legacy ? trace.body.slice(legacy[0].length).trim() : trace.body);
  return (
    <section className={`min-w-0 rounded-xl border px-3 py-2.5 ${router ? 'border-warning/30 bg-warning/5' : 'border-primary/30 bg-primary/5'}`}
      data-testid={`workflow-trace-${trace.kind}`}>
      <header className="flex flex-wrap items-center gap-2">
        <Icon size={15} aria-hidden="true" className={router ? 'text-warning' : 'text-primary'} />
        <h3 className="text-sm font-semibold">{router ? 'Router decision' : 'Finalizer'}</h3>
        <span className="rounded border border-base-300 px-1.5 py-0.5 text-[10px] text-base-content/70">Kalio workflow</span>
      </header>
      {trace.to && <p className="mt-2 inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-md bg-base-100/70 px-2 py-1 text-xs">
        <Route size={13} aria-hidden="true" /><span className="break-all">{trace.from} → {trace.to}</span>
      </p>}
      {confidence !== undefined && <dl className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(105px,1fr))] gap-1.5" data-testid="router-decision-fields">
        {fields.filter(field => field.value !== undefined).map(({ label, value, icon: FieldIcon }) => (
          <div key={label} className="min-w-0 rounded-md border border-base-300 bg-base-100/70 px-2 py-1.5">
            <dt className="flex items-center gap-1 text-[11px] text-base-content/70"><FieldIcon size={13} aria-hidden="true" />{label}</dt>
            <dd className="mt-0.5 break-words text-sm font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>}
      {output?.selectedStrategy && <p className="mt-2 break-words text-xs"><span className="font-semibold">Strategy</span> · {output.selectedStrategy}</p>}
      {body && <div className="mt-2 max-w-[78ch] break-words"><MarkdownViewer content={body} /></div>}
    </section>
  );
}
