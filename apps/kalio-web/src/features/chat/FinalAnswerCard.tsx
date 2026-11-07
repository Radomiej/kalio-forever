import { useRef, useState } from 'react';
import { CircleAlert, CircleCheck, FileCode, ListChecks, Workflow, X } from 'lucide-react';
import { MarkdownViewer } from '../../components/markdown/MarkdownViewer';
import { apiClient } from '../../services/apiClient';
import { useProjectStore } from '../../store/projectStore';
import { useSessionStore } from '../../store/sessionStore';

import { finalAnswerLabels as labels, parseFinalAnswer } from './finalAnswerReport';
export { parseFinalAnswer } from './finalAnswerReport';

function evidenceFiles(evidence: string[], projectRoot: string): string[] {
  const root = projectRoot.replaceAll('\\', '/').replace(/\/$/, '');
  const files = new Set<string>();
  for (const item of evidence) {
    const candidates = item.match(/`[^`]+`|[^\s"'()<>]+\.[a-zA-Z0-9]+(?=$|[\s"'():,;.!?])/g) ?? [];
    for (const candidate of candidates) {
      let path = candidate.replaceAll('`', '').replaceAll('\\', '/');
      if (path.toLowerCase().startsWith(`${root.toLowerCase()}/`)) path = path.slice(root.length + 1);
      if (/^[\w.-]+(?:\/[\w.-]+)*\.[\w]+$/.test(path)
        && !path.split('/').some(part => part === '..' || part === '.')) files.add(path);
    }
  }
  return [...files];
}

export function FinalAnswerCard({ content, sessionId }: { content: string; sessionId: string }) {
  const projectId = useSessionStore(state => state.sessions?.find(session => session.id === sessionId)?.projectId);
  const project = useProjectStore(state => state.projects.find(item => item.id === projectId));
  const [preview, setPreview] = useState<{ path: string; content?: string; failed?: boolean } | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const result = parseFinalAnswer(content);
  const Icon = result?.status === 'accepted' ? CircleCheck : CircleAlert;

  async function openFile(path: string) {
    setPreview({ path });
    dialogRef.current?.showModal();
    try {
      const response = await apiClient.get<{ content: string }>(`/api/sessions/${encodeURIComponent(sessionId)}/vfs/project-preview`, { params: { path } });
      setPreview(current => current?.path === path ? { path, content: response.data.content } : current);
    } catch {
      setPreview(current => current?.path === path ? { path, failed: true } : current);
    }
  }

  const evidenceRows = result?.evidence.map(text => ({
    text,
    files: project?.path ? evidenceFiles([text], project.path) : [],
  })) ?? [];
  return (
    <section className="min-w-0 space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-3" data-testid="architecture-final-answer">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Workflow size={16} aria-hidden="true" className="text-primary" />
          <h3 className="text-sm font-semibold">Final answer</h3>
          <span className="rounded border border-base-300 px-1.5 py-0.5 text-[10px] text-base-content/70">Kalio workflow</span>
        </div>
        {result && <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${result.status === 'accepted' ? 'text-success' : 'text-warning'}`}>
          <Icon size={15} aria-hidden="true" />{labels[result.status]}
        </span>}
      </header>
      {result ? <>
        {result.partial && <p className="text-xs text-base-content/70">Only the saved excerpt is available for this run.</p>}
        {result.answer && <MarkdownViewer content={result.answer} className="[&_p]:whitespace-pre-wrap" />}
        {result.status !== 'accepted' && result.blockingReason && <div className="rounded-md bg-warning/10 p-2 text-sm break-words">
          <p className="font-medium">Blocking reason</p><p className="whitespace-pre-wrap">{result.blockingReason}</p>
        </div>}
        {result.evidence.length > 0 && <div className="border-t border-base-300 pt-2 text-sm">
          <p className="mb-1 flex items-center gap-1.5 font-medium"><ListChecks size={14} aria-hidden="true" />Evidence</p>
          <ol className="divide-y divide-base-300 overflow-hidden rounded-lg border border-base-300">
            {evidenceRows.map(({ text, files }, index) => {
              const heading = /^([^:\r\n]{1,48}):\s+/.exec(text);
              return <li key={index} className="grid min-w-0 gap-1.5 bg-base-100/50 p-2.5" data-testid="final-answer-evidence-row">
                <p className="flex items-center gap-1.5 font-medium">
                  <ListChecks size={13} className="shrink-0 text-primary" aria-hidden="true" />
                  {heading?.[1] ?? `Evidence ${index + 1}`}
                </p>
                <p className="whitespace-pre-wrap break-words text-base-content/85">{heading ? text.slice(heading[0].length) : text}</p>
                {files.length > 0 && <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-base-content/70">{project?.name}</span>
                  {files.map(path => <button key={path} type="button"
                    className="inline-flex max-w-full items-center gap-1.5 break-all rounded border border-base-300 px-1.5 py-0.5 text-left text-xs text-primary underline"
                    onClick={() => void openFile(path)}>
                    <FileCode size={14} className="shrink-0" aria-hidden="true" />{path}
                  </button>)}
                </div>}
              </li>;
            })}
          </ol>
        </div>}
        {evidenceRows.some(row => row.files.length > 0) && (
          <dialog ref={dialogRef} className="modal" aria-label="Project file preview" onClose={() => setPreview(null)}>
            <div className="modal-box max-w-3xl">
              <div className="mb-3 flex items-start justify-between gap-2">
                <h4 className="break-all font-semibold">{preview?.path}</h4>
                <form method="dialog"><button type="submit" className="btn btn-ghost btn-sm" aria-label="Close preview"><X size={16} /></button></form>
              </div>
              {preview?.failed ? <p role="alert">File unavailable for text preview.</p>
                : preview?.content !== undefined ? <pre className="overflow-auto whitespace-pre-wrap break-all text-xs">{preview.content}</pre>
                  : <p role="status">Loading preview…</p>}
            </div>
          </dialog>
        )}
      </> : <MarkdownViewer content={content} />}
    </section>
  );
}
