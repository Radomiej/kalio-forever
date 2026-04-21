import { useEffect, useState } from 'react';
import { Plus, Trash2, Play, Pause, Square, Repeat, ChevronDown, ChevronRight } from 'lucide-react';
import type { AgentLoop, AgentTask, CreateAgentLoopDto, CreateAgentTaskDto } from '@kalio/types';

function StatusBadge({ status }: { status: AgentLoop['status'] }) {
  const map: Record<AgentLoop['status'], string> = {
    idle: 'badge-neutral',
    running: 'badge-success',
    paused: 'badge-warning',
    stopped: 'badge-neutral',
    error: 'badge-error',
    completed: 'badge-info',
  };
  return <span className={`badge badge-xs ${map[status]}`}>{status}</span>;
}

function LoopRow({ loop, onDelete, onRefresh }: { loop: AgentLoop; onDelete: (id: string) => void; onRefresh: () => void }) {
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [newTask, setNewTask] = useState('');

  const loadTasks = () => {
    setLoadingTasks(true);
    fetch(`/api/agent-loops/${loop.id}/tasks`)
      .then((r) => r.json())
      .then((data: AgentTask[]) => setTasks(data))
      .catch(() => setTasks([]))
      .finally(() => setLoadingTasks(false));
  };

  const toggle = () => {
    setOpen((v) => !v);
    if (!open) loadTasks();
  };

  const action = async (cmd: 'start' | 'pause' | 'stop') => {
    await fetch(`/api/agent-loops/${loop.id}/${cmd}`, { method: 'POST' });
    onRefresh();
  };

  const addTask = async () => {
    if (!newTask.trim()) return;
    const dto: CreateAgentTaskDto = { loopId: loop.id, title: newTask.trim() };
    await fetch(`/api/agent-loops/${loop.id}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dto),
    });
    setNewTask('');
    loadTasks();
  };

  return (
    <div className="border border-base-300 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-base-200">
        <button onClick={toggle} className="flex items-center gap-1 flex-1 min-w-0 text-left">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span className="text-sm font-medium truncate">{loop.name}</span>
          <StatusBadge status={loop.status} />
          <span className="text-xs text-base-content/40 ml-1">{loop.iterationCount} iters</span>
        </button>
        <div className="flex gap-1 shrink-0">
          {loop.status !== 'running' && (
            <button className="btn btn-xs btn-ghost text-success" onClick={() => action('start')} title="Start">
              <Play size={11} />
            </button>
          )}
          {loop.status === 'running' && (
            <button className="btn btn-xs btn-ghost text-warning" onClick={() => action('pause')} title="Pause">
              <Pause size={11} />
            </button>
          )}
          <button className="btn btn-xs btn-ghost text-error" onClick={() => action('stop')} title="Stop">
            <Square size={11} />
          </button>
          <button className="btn btn-xs btn-ghost text-error" onClick={() => onDelete(loop.id)} title="Delete">
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      {open && (
        <div className="px-3 py-2 space-y-2 bg-base-100">
          <p className="text-xs text-base-content/50 font-mono">{loop.systemPrompt || '(no system prompt)'}</p>
          <div className="divider my-1 text-xs">Tasks</div>
          {loadingTasks && <p className="text-xs text-base-content/40">Loading…</p>}
          {tasks.map((task) => (
            <div key={task.id} className="flex items-center gap-2 text-xs">
              <span className={`badge badge-xs ${task.status === 'done' ? 'badge-success' : task.status === 'failed' ? 'badge-error' : task.status === 'running' ? 'badge-warning' : 'badge-neutral'}`}>
                {task.status}
              </span>
              <span className="flex-1 truncate">{task.title}</span>
              <span className="text-base-content/30 font-mono">p{task.priority}</span>
            </div>
          ))}
          <div className="flex gap-1 mt-1">
            <input
              className="input input-xs input-bordered flex-1"
              placeholder="Add task…"
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void addTask(); }}
            />
            <button className="btn btn-xs btn-primary" onClick={addTask}>+</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function AgentLoopPanel() {
  const [loops, setLoops] = useState<AgentLoop[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPrompt, setNewPrompt] = useState('');

  const load = () => {
    setLoading(true);
    fetch('/api/agent-loops')
      .then((r) => r.json())
      .then((data: AgentLoop[]) => setLoops(data))
      .catch(() => setLoops([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const dto: CreateAgentLoopDto = {
      name: newName.trim(),
      personaId: 'default',
      systemPrompt: newPrompt.trim(),
      mode: 'continuous',
    };
    await fetch('/api/agent-loops', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dto),
    });
    setNewName('');
    setNewPrompt('');
    setCreating(false);
    load();
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/agent-loops/${id}`, { method: 'DELETE' });
    setLoops((prev) => prev.filter((l) => l.id !== id));
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-base-300 flex items-center gap-2">
        <Repeat size={14} className="text-base-content/50" />
        <span className="text-sm font-semibold flex-1">Agent Loops</span>
        <button className="btn btn-xs btn-ghost" onClick={() => setCreating((v) => !v)} title="New loop">
          <Plus size={14} />
        </button>
      </div>

      {creating && (
        <div className="px-3 py-2 border-b border-base-300 space-y-2 bg-base-200">
          <input
            className="input input-sm input-bordered w-full"
            placeholder="Loop name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
          />
          <textarea
            className="textarea textarea-bordered w-full text-xs resize-none"
            placeholder="System prompt (optional)"
            rows={2}
            value={newPrompt}
            onChange={(e) => setNewPrompt(e.target.value)}
          />
          <div className="flex gap-1 justify-end">
            <button className="btn btn-xs btn-ghost" onClick={() => setCreating(false)}>Cancel</button>
            <button className="btn btn-xs btn-primary" onClick={handleCreate}>Create</button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading && <p className="text-xs text-base-content/40">Loading…</p>}
        {!loading && loops.length === 0 && (
          <p className="text-xs text-base-content/40">No agent loops. Click + to create one.</p>
        )}
        {loops.map((loop) => (
          <LoopRow key={loop.id} loop={loop} onDelete={handleDelete} onRefresh={load} />
        ))}
      </div>
    </div>
  );
}
