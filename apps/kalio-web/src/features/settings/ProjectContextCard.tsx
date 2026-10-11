import { useEffect, useId, useRef, useState } from 'react';
import type { EmbeddingStatus, Project, ProjectResourceSearchResult } from '@kalio/types';
import { projectContextTransport, type ProjectContextIndexStatus, type ProjectContextSettings } from './project-context.transport';

const DEFAULT_SETTINGS: ProjectContextSettings = { enabled: false, modelRevision: '', providerScope: 'local-user' };

function isRemote(status: EmbeddingStatus | null): boolean {
  if (!status) return true;
  if (status.provider === 'local-transformers' || status.provider === 'mock') return false;
  if (status.provider === 'ollama') {
    try { return !['localhost', '127.0.0.1', '[::1]'].includes(new URL(status.baseUrlMasked).hostname); }
    catch { return true; }
  }
  return true;
}

export function ProjectContextCard({ status, onApplied }: { status: EmbeddingStatus | null; onApplied?: () => void | Promise<void> }) {
  const projectSelectId = useId();
  const [draft, setDraft] = useState(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState<ProjectContextSettings | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const selectedProject = useRef('');
  const [query, setQuery] = useState('');
  const [remoteConsent, setRemoteConsent] = useState(false);
  const [busy, setBusy] = useState<string | null>('load');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [indexStatus, setIndexStatus] = useState<ProjectContextIndexStatus | null>(null);
  const [results, setResults] = useState<ProjectResourceSearchResult[] | null>(null);
  const generation = useRef(0);
  const loadGeneration = useRef(0);
  const mounted = useRef(false);
  const remote = isRemote(status);
  const dirty = draft.enabled !== saved?.enabled;
  const identityVerified = Boolean(saved?.modelRevision && saved.modelRevision !== 'unresolved'
    && saved.providerScope && saved.providerScope !== 'unresolved');
  // Keep aligned with ProjectResourceIndexService.assertReusable: Ollama metadata
  // identifies a model but does not pin which weights an inference request uses.
  const projectIndexSupported = identityVerified && status?.provider !== 'ollama';
  const canRun = !busy && !dirty && saved?.enabled && projectId && status?.configured
    && projectIndexSupported && (!remote || remoteConsent);
  const canSearch = canRun && Boolean(indexStatus);

  async function load() {
    const current = ++loadGeneration.current;
    setBusy('load'); setError(null); setSaved(null); setIndexStatus(null);
    try {
      const [settings, metadata] = await Promise.all([projectContextTransport.getSettings(), projectContextTransport.getProjects()]);
      if (!mounted.current || current !== loadGeneration.current) return;
      let index: ProjectContextIndexStatus | null = null;
      if (selectedProject.current) {
        index = await projectContextTransport.getStatus(selectedProject.current);
      }
      if (!mounted.current || current !== loadGeneration.current) return;
      setDraft(settings); setSaved(settings); setProjects(metadata.filter(project => Boolean(project.path))); setIndexStatus(index);
    } catch (cause) {
      if (mounted.current && current === loadGeneration.current) setError(cause instanceof Error ? cause.message : 'Failed to load project context.');
    } finally { if (mounted.current && current === loadGeneration.current) setBusy(null); }
  }

  useEffect(() => {
    const requestGeneration = generation;
    const pendingLoad = loadGeneration;
    mounted.current = true;
    setRemoteConsent(false); setResults(null); setIndexStatus(null); setMessage(null);
    void load();
    return () => { mounted.current = false; requestGeneration.current++; pendingLoad.current++; };
  }, [status?.provider, status?.model, status?.profileId, status?.configured, status?.baseUrlMasked]);

  async function run(action: 'apply' | 'refresh' | 'search') {
    if (busy || (action === 'apply' ? !saved || !dirty : action === 'search' ? !canSearch : !canRun)) return;
    const current = ++generation.current;
    const allowRemote = remote && remoteConsent;
    setRemoteConsent(false); setBusy(action); setError(null); setMessage(null); setResults(null);
    try {
      if (action === 'apply') {
        const settings = await projectContextTransport.saveSettings({ enabled: draft.enabled });
        if (!mounted.current || current !== generation.current) return;
        setSaved(settings); setDraft(settings); setIndexStatus(null);
        await onApplied?.();
        if (mounted.current && current === generation.current) setMessage('Project context settings applied.');
      } else if (action === 'refresh') {
        const result = await projectContextTransport.refresh(projectId, allowRemote);
        if (!mounted.current || current !== generation.current) return;
        setIndexStatus({ projectId: result.projectId, space: result.space, indexedChunks: result.indexedChunks, indexedAt: result.indexedAt });
        setMessage(`Indexed ${result.indexedFiles} files, ${result.indexedChunks} chunks. Skipped ${result.skipped.length} files.`);
      } else {
        const found = await projectContextTransport.search(projectId, query.trim(), allowRemote);
        if (!mounted.current || current !== generation.current) return;
        const updatedIndex = await projectContextTransport.getStatus(projectId);
        if (mounted.current && current === generation.current) { setResults(found); setIndexStatus(updatedIndex); }
      }
    } catch (cause) {
      if (mounted.current && current === generation.current) setError(cause instanceof Error ? cause.message : 'Project context operation failed.');
    } finally { if (mounted.current && current === generation.current) setBusy(null); }
  }

  async function selectProject(id: string) {
    const current = ++generation.current;
    selectedProject.current = id;
    setProjectId(id); setResults(null); setIndexStatus(null); setMessage(null); setError(null); setRemoteConsent(false);
    if (!id) return;
    try {
      const value = await projectContextTransport.getStatus(id);
      if (mounted.current && current === generation.current) setIndexStatus(value);
    } catch (cause) {
      if (mounted.current && current === generation.current) setError(cause instanceof Error ? cause.message : 'Failed to load index status.');
    }
  }

  return (
    <section aria-label="Project context" className="rounded-lg border border-base-300 p-4 space-y-3">
      <h3 className="text-sm font-semibold">Project Context</h3>
      <p className="text-sm text-base-content/70">Let agents find relevant files in your project. Uses the selected embedding model above.</p>
      <p className="text-xs text-base-content/60">Search refreshes changed files automatically. Nothing is scanned in the background. Changing the model creates a separate index; your previous index is kept.</p>
      <fieldset disabled={Boolean(busy) || !saved} className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="checkbox checkbox-sm" checked={draft.enabled} onChange={event => setDraft({ ...draft, enabled: event.target.checked })} />
          Allow project indexing
        </label>
        <button type="button" className="btn btn-sm btn-primary" disabled={!dirty} onClick={() => void run('apply')}>Apply</button>
        {dirty && <p className="text-xs">Apply settings before refreshing or searching.</p>}
        <label htmlFor={projectSelectId} className="flex flex-col gap-1">
          <span className="text-xs">Project</span>
          <select id={projectSelectId} className="select select-sm select-bordered w-full" value={projectId} onChange={event => void selectProject(event.target.value)}>
            <option value="">Select a project</option>
            {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
        {projects.length === 0 && <p className="text-xs">No registered projects with a workspace path.</p>}
        {!busy && saved && !projectIndexSupported && <p role="status" className="text-xs text-warning">Project indexing is not ready for this model yet. It stays disabled to avoid mixing results from different model versions. No model details need to be entered here.</p>}
        {indexStatus && projectIndexSupported && <div role="status" className="rounded border border-base-300 p-3 space-y-1 text-sm">
          <p className="font-medium">{indexStatus.indexedAt === null ? 'Not indexed for this model' : 'Project index ready'}</p>
          <p className="text-xs break-words">{indexStatus.space.model}{indexStatus.indexedAt === null
            ? ' — the first search will create this index.'
            : ` · ${indexStatus.indexedChunks} searchable sections · Updated ${new Date(indexStatus.indexedAt).toLocaleString()}`}</p>
        </div>}
        {remote && <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="checkbox checkbox-sm shrink-0" checked={remoteConsent} onChange={event => setRemoteConsent(event.target.checked)} />
          Allow remote processing for the next refresh or search only
        </label>}
        <button type="button" className="btn btn-sm" disabled={!canRun} onClick={() => void run('refresh')}>Refresh project index</button>
        <form className="space-y-2" onSubmit={event => { event.preventDefault(); if (query.trim()) void run('search'); }}>
          <label className="flex flex-col gap-1">
            <span className="text-xs">Search project context</span>
            <input className="input input-sm input-bordered w-full" maxLength={4096} value={query} onChange={event => { setQuery(event.target.value); setResults(null); }} />
          </label>
          <button type="submit" className="btn btn-sm" disabled={!canSearch || !query.trim()}>Search</button>
        </form>
        <p className="text-xs text-base-content/60">Code and text are searchable by content. For images, recordings, videos and PDFs, only file details are indexed — not their contents.</p>
      </fieldset>
      {busy && <p role="status" className="text-xs">{busy === 'load' ? 'Loading project context…' : 'Working…'}</p>}
      {error && <p role="alert" className="text-xs text-error break-words">{error}</p>}
      {!saved && !busy && <button type="button" className="btn btn-sm" onClick={() => void load()}>Retry loading</button>}
      {message && <p role="status" className="text-xs">{message}</p>}
      {results?.length === 0 && <p role="status" className="text-xs">No matching project resources.</p>}
      {results && results.length > 0 && <ul aria-label="Project context results" className="space-y-3">
        {results.map(result => <li key={result.id} className="rounded border border-base-300 p-3 min-w-0">
          <p className="font-mono text-xs break-all">{result.path}</p>
          <p className="text-xs">Type: {result.resourceType} · Representation: {result.representation}</p>
          <pre className="text-xs whitespace-pre-wrap break-words">{result.content}</pre>
        </li>)}
      </ul>}
    </section>
  );
}
