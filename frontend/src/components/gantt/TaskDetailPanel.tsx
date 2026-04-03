import { useMemo, useState, useEffect, useCallback } from 'react';
import type { Task, Project, Person } from '../../lib/api';
import { useUpdateTask } from '../../hooks/useTasks';
import { useUIStore } from '../../store/uiStore';

interface Props {
  task: Task;
  projects: Project[];
  people: Person[];
}

const STATUS_OPTIONS = ['todo', 'in_progress', 'blocked', 'done'] as const;
const STATUS_LABELS: Record<string, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  done: 'Done',
};
const STATUS_COLORS: Record<string, string> = {
  todo: '#9ca3af',
  in_progress: '#3b82f6',
  blocked: '#ef4444',
  done: '#22c55e',
};

// ── Checklist helpers ────────────────────────────────────────────────────────
interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

function parseNotes(raw: string | null | undefined): { freeform: string; checklist: ChecklistItem[] } {
  if (!raw) return { freeform: '', checklist: [] };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'freeform' in parsed) {
      return { freeform: parsed.freeform ?? '', checklist: parsed.checklist ?? [] };
    }
  } catch {
    // Legacy plain text notes
  }
  return { freeform: raw, checklist: [] };
}

function serializeNotes(freeform: string, checklist: ChecklistItem[]): string {
  if (!freeform && checklist.length === 0) return '';
  return JSON.stringify({ freeform, checklist });
}

function newItem(text = ''): ChecklistItem {
  return { id: Math.random().toString(36).slice(2), text, done: false };
}

// ── Slider with local state (smooth dragging) ────────────────────────────────
function SmoothSlider({
  label, min, max, value, onCommit,
}: {
  label: string; min: number; max: number; value: number;
  onCommit: (v: number) => void;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);

  return (
    <div>
      <label className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
        {label}: {local}%
      </label>
      <input
        type="range"
        min={min}
        max={max}
        value={local}
        onChange={(e) => setLocal(Number(e.target.value))}
        onMouseUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        onTouchEnd={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        className="block w-full mt-1"
      />
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export function TaskDetailPanel({ task, projects, people }: Props) {
  const setSelectedTaskId = useUIStore((s) => s.setSelectedTaskId);
  const updateTask = useUpdateTask();

  const project = useMemo(
    () => projects.find((p) => p.id === task.project_id),
    [projects, task.project_id]
  );

  const tags: string[] = useMemo(() => {
    try { return JSON.parse(task.tags); } catch { return []; }
  }, [task.tags]);

  const { freeform: initFree, checklist: initList } = useMemo(
    () => parseNotes(task.notes),
    [task.notes]
  );

  const [freeform, setFreeform] = useState(initFree);
  const [checklist, setChecklist] = useState<ChecklistItem[]>(initList);
  const [newItemText, setNewItemText] = useState('');
  const [showChecklist, setShowChecklist] = useState(initList.length > 0);

  // Sync if task changes
  useEffect(() => {
    const { freeform: f, checklist: c } = parseNotes(task.notes);
    setFreeform(f);
    setChecklist(c);
    setShowChecklist(c.length > 0);
  }, [task.id, task.notes]);

  const handleUpdate = useCallback((data: Partial<Task>) => {
    updateTask.mutate({ id: task.id, data });
  }, [task.id, updateTask]);

  const saveNotes = useCallback((f: string, c: ChecklistItem[]) => {
    handleUpdate({ notes: serializeNotes(f, c) });
  }, [handleUpdate]);

  const commitFreeform = useCallback(() => {
    saveNotes(freeform, checklist);
  }, [freeform, checklist, saveNotes]);

  const toggleItem = useCallback((id: string) => {
    const next = checklist.map((item) =>
      item.id === id ? { ...item, done: !item.done } : item
    );
    setChecklist(next);
    saveNotes(freeform, next);
  }, [checklist, freeform, saveNotes]);

  const deleteItem = useCallback((id: string) => {
    const next = checklist.filter((item) => item.id !== id);
    setChecklist(next);
    saveNotes(freeform, next);
  }, [checklist, freeform, saveNotes]);

  const addItem = useCallback(() => {
    const text = newItemText.trim();
    if (!text) return;
    const next = [...checklist, newItem(text)];
    setChecklist(next);
    setNewItemText('');
    saveNotes(freeform, next);
  }, [checklist, freeform, newItemText, saveNotes]);

  const updateItemText = useCallback((id: string, text: string) => {
    setChecklist((prev) => prev.map((item) => item.id === id ? { ...item, text } : item));
  }, []);

  const commitItemText = useCallback((id: string) => {
    saveNotes(freeform, checklist);
  }, [freeform, checklist, saveNotes]);

  return (
    <div
      className="w-[360px] flex-shrink-0 border-l overflow-y-auto p-4 flex flex-col gap-4"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-elevated)' }}
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <h2 className="text-lg font-semibold flex-1" style={{ color: 'var(--text-primary)' }}>
          {task.title}
        </h2>
        <button
          onClick={() => setSelectedTaskId(null)}
          className="ml-2 text-xl leading-none"
          style={{ color: 'var(--text-muted)' }}
        >
          &times;
        </button>
      </div>

      {/* Project */}
      {project && (
        <div>
          <label className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            Project
          </label>
          <div className="flex items-center gap-2 mt-1">
            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: project.color }} />
            <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{project.name}</span>
          </div>
        </div>
      )}

      {/* Assignee */}
      <div>
        <label className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          Assignee
        </label>
        <select
          className="block w-full mt-1 p-1.5 rounded text-sm"
          style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
          value={task.assignee_id ?? ''}
          onChange={(e) => handleUpdate({ assignee_id: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">Unassigned</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {/* Status */}
      <div>
        <label className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          Status
        </label>
        <div className="flex gap-1 mt-1 flex-wrap">
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => handleUpdate({ status: s })}
              className="px-2 py-1 rounded text-xs font-medium"
              style={{
                backgroundColor: task.status === s ? STATUS_COLORS[s] : 'var(--bg-surface)',
                color: task.status === s ? '#fff' : 'var(--text-muted)',
                border: '1px solid var(--border)',
              }}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Dates */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Start</label>
          <input
            type="date"
            className="block w-full mt-1 p-1.5 rounded text-sm"
            style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            value={task.start_date ?? ''}
            onChange={(e) => handleUpdate({ start_date: e.target.value || null })}
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>End</label>
          <input
            type="date"
            className="block w-full mt-1 p-1.5 rounded text-sm"
            style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            value={task.end_date ?? ''}
            onChange={(e) => handleUpdate({ end_date: e.target.value || null })}
          />
        </div>
      </div>

      {/* Deadline */}
      {task.deadline && (
        <div>
          <label className="text-xs uppercase tracking-wider" style={{ color: 'var(--today-line)' }}>
            Hard Deadline
          </label>
          <div className="text-sm mt-1" style={{ color: 'var(--today-line)' }}>{task.deadline}</div>
        </div>
      )}

      {/* Priority */}
      <div>
        <label className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Priority</label>
        <select
          className="block w-full mt-1 p-1.5 rounded text-sm"
          style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
          value={task.priority}
          onChange={(e) => handleUpdate({ priority: Number(e.target.value) })}
        >
          <option value={1}>Low</option>
          <option value={2}>Medium</option>
          <option value={3}>High</option>
        </select>
      </div>

      {/* Density slider (smooth) */}
      <SmoothSlider
        label="Density"
        min={1}
        max={100}
        value={task.density}
        onCommit={(v) => handleUpdate({ density: v })}
      />

      {/* Progress slider (smooth) */}
      <SmoothSlider
        label="Progress"
        min={0}
        max={100}
        value={task.progress}
        onCommit={(v) => handleUpdate({ progress: v })}
      />

      {/* Tags */}
      {tags.length > 0 && (
        <div>
          <label className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Tags</label>
          <div className="flex gap-1 mt-1 flex-wrap">
            {tags.map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 rounded-full text-xs"
                style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Notes + Checklist */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            Notes
          </label>
          <button
            onClick={() => setShowChecklist((v) => !v)}
            className="text-xs px-2 py-0.5 rounded"
            style={{ border: '1px solid var(--border)', color: 'var(--text-muted)', backgroundColor: showChecklist ? 'var(--accent)' : 'transparent', color: showChecklist ? '#fff' : 'var(--text-muted)' }}
          >
            ✓ Checklist
          </button>
        </div>

        <textarea
          rows={4}
          className="block w-full rounded text-sm p-2 resize-y"
          style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', fontFamily: 'inherit' }}
          placeholder="Add notes…"
          value={freeform}
          onChange={(e) => setFreeform(e.target.value)}
          onBlur={commitFreeform}
        />

        {showChecklist && (
          <div className="mt-2 space-y-1">
            {checklist.map((item) => (
              <div key={item.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={item.done}
                  onChange={() => toggleItem(item.id)}
                  className="flex-shrink-0"
                />
                <input
                  type="text"
                  className="flex-1 text-sm bg-transparent outline-none border-b"
                  style={{
                    color: item.done ? 'var(--text-muted)' : 'var(--text-primary)',
                    textDecoration: item.done ? 'line-through' : 'none',
                    borderColor: 'var(--border)',
                  }}
                  value={item.text}
                  onChange={(e) => updateItemText(item.id, e.target.value)}
                  onBlur={() => commitItemText(item.id)}
                />
                <button
                  onClick={() => deleteItem(item.id)}
                  className="text-xs flex-shrink-0"
                  style={{ color: 'var(--text-muted)' }}
                >
                  ×
                </button>
              </div>
            ))}
            {/* New item input */}
            <div className="flex items-center gap-2 mt-1">
              <input
                type="text"
                className="flex-1 text-sm bg-transparent outline-none border-b"
                style={{ color: 'var(--text-primary)', borderColor: 'var(--border)' }}
                placeholder="Add item…"
                value={newItemText}
                onChange={(e) => setNewItemText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }}
              />
              <button
                onClick={addItem}
                className="text-xs px-2 py-0.5 rounded"
                style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}
              >
                +
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Metadata */}
      <div className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
        <div>ID: {task.id} {task.yaml_id && `(${task.yaml_id})`}</div>
        <div>Type: {task.type}</div>
        <div>Created: {task.created_at}</div>
        <div>Updated: {task.updated_at}</div>
      </div>
    </div>
  );
}
