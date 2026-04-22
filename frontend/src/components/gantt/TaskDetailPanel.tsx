import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import type { Task, Project, Person } from '../../lib/api';
import { useUpdateTask, useDeleteTask } from '../../hooks/useTasks';
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
  blocked: 'var(--urgent)',
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
  const deleteTask = useDeleteTask();
  const migratedRef = useRef<Set<number>>(new Set());

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

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [hardDeadline, setHardDeadline] = useState(!!task.hard_deadline);
  const [freeform, setFreeform] = useState(initFree);
  const [checklist, setChecklist] = useState<ChecklistItem[]>(initList);
  const [newItemText, setNewItemText] = useState('');
  const [showChecklist, setShowChecklist] = useState(initList.length > 0);

  // Sync if task changes
  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description ?? '');
    setHardDeadline(!!task.hard_deadline);
    const { freeform: f, checklist: c } = parseNotes(task.notes);
    setFreeform(f);
    setChecklist(c);
    setShowChecklist(c.length > 0);
  }, [task.id, task.notes, task.description, task.hard_deadline]);

  // One-time migration: move markdown checklist items from description → UI checklist
  useEffect(() => {
    if (!task.description || migratedRef.current.has(task.id)) return;
    const pattern = /^[ \t]*-\s*\[([ xX])\]\s*(.+)$/gm;
    const matches = [...task.description.matchAll(pattern)];
    if (matches.length === 0) return;
    migratedRef.current.add(task.id);

    const migrated: ChecklistItem[] = matches.map((m) => ({
      id: Math.random().toString(36).slice(2),
      text: m[2].trim(),
      done: m[1].toLowerCase() === 'x',
    }));
    const cleanedDesc = task.description.replace(/^[ \t]*-\s*\[([ xX])\]\s*.+\n?/gm, '').trim() || null;
    const { freeform: f, checklist: c } = parseNotes(task.notes);
    const merged = [...c, ...migrated];

    updateTask.mutate({ id: task.id, data: { description: cleanedDesc, notes: serializeNotes(f, merged) } });
    setDescription(cleanedDesc ?? '');
    setChecklist(merged);
    setShowChecklist(true);
  }, [task.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
      className="w-full flex-shrink-0 border-l overflow-y-auto p-4 flex flex-col gap-3"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-elevated)' }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <input
          className="text-base font-semibold flex-1 bg-transparent outline-none"
          style={{
            color: 'var(--text-primary)',
            borderBottom: '1px solid transparent',
            paddingBottom: 2,
            transition: 'border-color 0.12s',
          }}
          onFocus={(e) => { (e.target as HTMLElement).style.borderBottomColor = 'var(--accent)'; }}
          onBlur={(e) => {
            (e.target as HTMLElement).style.borderBottomColor = 'transparent';
            if (title.trim()) handleUpdate({ title: title.trim() }); else setTitle(task.title);
          }}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
        <button onClick={() => setSelectedTaskId(null)} className="btn-icon mt-0.5 flex-shrink-0">
          &times;
        </button>
      </div>

      {/* Project */}
      <div>
        <label className="text-xs font-medium tracking-wide uppercase" style={{ color: 'var(--text-muted)', opacity: 0.7 }}>Project</label>
        <div className="flex items-center gap-2 mt-1">
          {project && <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: project.color }} />}
          <select
            className="field flex-1"
            value={task.project_id ?? ''}
            onChange={(e) => handleUpdate({ project_id: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">No project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      {/* Assignee */}
      <div>
        <label className="text-xs font-medium tracking-wide uppercase" style={{ color: 'var(--text-muted)', opacity: 0.7 }}>Assignee</label>
        <select
          className="field mt-1"
          value={task.assignee_id ?? ''}
          onChange={(e) => handleUpdate({ assignee_id: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">Unassigned</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {/* Description */}
      <div>
        <label className="text-xs font-medium tracking-wide uppercase" style={{ color: 'var(--text-muted)', opacity: 0.7 }}>Description</label>
        <textarea
          rows={3}
          className="field mt-1 resize-y"
          placeholder="Add description…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => handleUpdate({ description: description || null })}
        />
      </div>

      {/* Status */}
      <div>
        <label className="text-xs font-medium tracking-wide uppercase" style={{ color: 'var(--text-muted)', opacity: 0.7 }}>Status</label>
        <div className="flex gap-1 mt-1.5 flex-wrap">
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => handleUpdate({ status: s })}
              className="px-2.5 py-1 rounded-full text-xs font-medium transition-all"
              style={{
                backgroundColor: task.status === s ? STATUS_COLORS[s] + '25' : 'transparent',
                color: task.status === s ? STATUS_COLORS[s] : 'var(--text-muted)',
                border: `1.5px solid ${task.status === s ? STATUS_COLORS[s] + '80' : 'transparent'}`,
                outline: task.status === s ? 'none' : 'none',
              }}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Dates */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-medium tracking-wide uppercase" style={{ color: 'var(--text-muted)', opacity: 0.7 }}>Start</label>
          <input
            type="date"
            className="field mt-1"
            value={task.start_date ?? ''}
            onChange={(e) => handleUpdate({ start_date: e.target.value || null })}
          />
        </div>
        <div>
          <label className="text-xs font-medium tracking-wide uppercase" style={{ color: 'var(--text-muted)', opacity: 0.7 }}>End</label>
          <input
            type="date"
            className="field mt-1"
            value={task.end_date ?? ''}
            onChange={(e) => handleUpdate({ end_date: e.target.value || null })}
          />
        </div>
      </div>

      {/* Deadline */}
      {task.deadline && (
        <div>
          <label className="text-xs font-medium tracking-wide uppercase" style={{ color: 'var(--text-muted)', opacity: 0.7 }}>Deadline</label>
          <div className="text-sm mt-1" style={{ color: 'var(--text-primary)' }}>{task.deadline}</div>
        </div>
      )}

      {/* Hard deadline toggle */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="hard-deadline-toggle"
          checked={hardDeadline}
          onChange={(e) => {
            setHardDeadline(e.target.checked);
            handleUpdate({ hard_deadline: e.target.checked ? 1 : 0 });
          }}
          className="flex-shrink-0"
          style={{ accentColor: 'var(--urgent)' }}
        />
        <label
          htmlFor="hard-deadline-toggle"
          className="text-sm cursor-pointer select-none"
          style={{ color: hardDeadline ? 'var(--urgent)' : 'var(--text-muted)', transition: 'color 0.12s' }}
        >
          Hard deadline
        </label>
      </div>

      {/* Priority */}
      <div>
        <label className="text-xs font-medium tracking-wide uppercase" style={{ color: 'var(--text-muted)', opacity: 0.7 }}>Priority</label>
        <select
          className="field mt-1"
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
          <label className="text-xs font-medium tracking-wide uppercase" style={{ color: 'var(--text-muted)', opacity: 0.7 }}>Tags</label>
          <div className="flex gap-1 mt-1 flex-wrap">
            {tags.map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 rounded-full text-xs"
                style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-muted)' }}
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Notes + Checklist */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-medium tracking-wide uppercase" style={{ color: 'var(--text-muted)', opacity: 0.7 }}>Notes</label>
          <button
            onClick={() => setShowChecklist((v) => !v)}
            className={`btn-ghost text-xs ${showChecklist ? 'active' : ''}`}
            style={{ padding: '2px 8px', borderRadius: 999 }}
          >
            ✓ Checklist
          </button>
        </div>

        <textarea
          rows={4}
          className="field resize-y"
          placeholder="Add notes…"
          value={freeform}
          onChange={(e) => setFreeform(e.target.value)}
          onBlur={commitFreeform}
        />

        {showChecklist && (
          <div className="mt-2 space-y-1.5">
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
                  className="flex-1 text-sm bg-transparent outline-none"
                  style={{
                    color: item.done ? 'var(--text-muted)' : 'var(--text-primary)',
                    textDecoration: item.done ? 'line-through' : 'none',
                    borderBottom: '1px solid var(--border)',
                    paddingBottom: 1,
                  }}
                  value={item.text}
                  onChange={(e) => updateItemText(item.id, e.target.value)}
                  onBlur={() => commitItemText(item.id)}
                />
                <button onClick={() => deleteItem(item.id)} className="btn-icon flex-shrink-0" style={{ width: 18, height: 18, fontSize: '0.85rem' }}>
                  ×
                </button>
              </div>
            ))}
            {/* New item input */}
            <div className="flex items-center gap-2 mt-1">
              <input
                type="text"
                className="flex-1 text-sm bg-transparent outline-none"
                style={{ color: 'var(--text-primary)', borderBottom: '1px solid var(--border)', paddingBottom: 1 }}
                placeholder="Add item…"
                value={newItemText}
                onChange={(e) => setNewItemText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }}
              />
              <button onClick={addItem} className="btn-icon" style={{ width: 20, height: 20 }}>+</button>
            </div>
          </div>
        )}
      </div>

      {/* Metadata */}
      <div className="text-xs mt-1 space-y-0.5" style={{ color: 'var(--text-muted)', opacity: 0.5 }}>
        <div>ID: {task.id} {task.yaml_id && `(${task.yaml_id})`} · {task.type}</div>
        <div>Created: {task.created_at?.slice(0, 10)}</div>
      </div>

      {/* Delete */}
      <button
        onClick={() => {
          deleteTask.mutate(task.id);
          setSelectedTaskId(null);
        }}
        className="w-full mt-1 py-1.5 rounded-lg text-sm font-medium transition-colors"
        style={{ backgroundColor: '#FF5A6F18', color: 'var(--urgent)', border: 'none' }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#FF5A6F28'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#FF5A6F18'; }}
      >
        Delete task
      </button>
    </div>
  );
}
