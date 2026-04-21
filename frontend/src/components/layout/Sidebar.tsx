import { useRef, useState, useCallback } from 'react';
import {
  useProjects, usePeople,
  useUpdateProject, useCreateProject,
  useUpdatePerson, useCreatePerson, useDeletePerson,
} from '../../hooks/useTasks';
import { useUIStore } from '../../store/uiStore';

// ── Inline-rename input ───────────────────────────────────────────────────────
function RenameInput({
  value,
  onCommit,
  onCancel,
}: { value: string; onCommit: (v: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(value);
  return (
    <input
      autoFocus
      className="flex-1 text-sm bg-transparent outline-none border-b min-w-0"
      style={{ color: 'var(--text-primary)', borderColor: 'var(--accent)' }}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { if (text.trim()) onCommit(text.trim()); else onCancel(); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { if (text.trim()) onCommit(text.trim()); else onCancel(); }
        if (e.key === 'Escape') onCancel();
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

// ── New-item form (inline at bottom of list) ──────────────────────────────────
function NewItemForm({
  placeholder,
  defaultColor,
  onSave,
  onCancel,
}: {
  placeholder: string;
  defaultColor: string;
  onSave: (name: string, color: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(defaultColor);

  const commit = () => { if (name.trim()) onSave(name.trim(), color); else onCancel(); };

  return (
    <li className="flex items-center gap-2 py-1 px-1">
      <label style={{ position: 'relative', flexShrink: 0, cursor: 'pointer' }}>
        <span className="w-3 h-3 rounded-sm block" style={{ backgroundColor: color }} />
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', padding: 0, border: 'none' }}
        />
      </label>
      <input
        autoFocus
        className="flex-1 text-sm bg-transparent outline-none border-b min-w-0"
        style={{ color: 'var(--text-primary)', borderColor: 'var(--accent)' }}
        placeholder={placeholder}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') onCancel();
        }}
      />
    </li>
  );
}

// ── Main Sidebar ──────────────────────────────────────────────────────────────
export function Sidebar() {
  const { data: projects } = useProjects();
  const { data: people } = usePeople();
  const updateProject = useUpdateProject();
  const createProject = useCreateProject();
  const updatePerson = useUpdatePerson();
  const createPerson = useCreatePerson();
  const deletePerson = useDeletePerson();

  const {
    visibleProjectIds, toggleProjectVisibility, showAllProjects,
    visiblePersonIds, togglePersonVisibility, showAllPeople,
    personOrder, setPersonOrder,
    projectOrder, setProjectOrder,
  } = useUIStore();

  // ── Project drag-to-reorder ────────────────────────────────────────────────
  const dragProjectId = useRef<number | null>(null);
  const [dragOverProjectId, setDragOverProjectId] = useState<number | null>(null);

  // ── People drag-to-reorder ─────────────────────────────────────────────────
  const dragPersonId = useRef<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);

  // ── Inline-rename state ────────────────────────────────────────────────────
  const [renamingProjectId, setRenamingProjectId] = useState<number | null>(null);
  const [renamingPersonId, setRenamingPersonId] = useState<number | null>(null);

  // ── New-item form state ────────────────────────────────────────────────────
  const [addingProject, setAddingProject] = useState(false);
  const [addingPerson, setAddingPerson] = useState(false);

  // ── Show-archived toggle ──────────────────────────────────────────────────
  const [showArchived, setShowArchived] = useState(false);

  // ── Build ordered lists ────────────────────────────────────────────────────
  const orderedProjects = (() => {
    if (!projects) return [];
    const visible = showArchived ? projects : projects.filter((p) => !p.archived);
    if (projectOrder.length === 0) return visible;
    const byId = Object.fromEntries(visible.map((p) => [p.id, p]));
    const ordered = projectOrder.map((id) => byId[id]).filter(Boolean);
    const inOrder = new Set(projectOrder);
    visible.forEach((p) => { if (!inOrder.has(p.id)) ordered.push(p); });
    return ordered;
  })();

  const orderedPeople = (() => {
    if (!people) return [];
    if (personOrder.length === 0) return people;
    const byId = Object.fromEntries(people.map((p) => [p.id, p]));
    const ordered = personOrder.map((id) => byId[id]).filter(Boolean);
    const inOrder = new Set(personOrder);
    people.forEach((p) => { if (!inOrder.has(p.id)) ordered.push(p); });
    return ordered;
  })();

  // ── Drag helpers ──────────────────────────────────────────────────────────
  const handlePersonDrop = useCallback((targetId: number) => {
    const srcId = dragPersonId.current;
    if (!srcId || srcId === targetId || !people) return;
    const ids = orderedPeople.map((p) => p.id);
    const srcIdx = ids.indexOf(srcId);
    const tgtIdx = ids.indexOf(targetId);
    if (srcIdx === -1 || tgtIdx === -1) return;
    const next = [...ids];
    next.splice(srcIdx, 1);
    next.splice(tgtIdx, 0, srcId);
    setPersonOrder(next);
    dragPersonId.current = null;
    setDragOverId(null);
  }, [orderedPeople, people, setPersonOrder]);

  const hasArchivedProjects = projects?.some((p) => p.archived) ?? false;

  return (
    <aside
      className="w-60 flex-shrink-0 border-r overflow-y-auto p-4"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)' }}
    >
      {/* ── Projects ── */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          Projects
        </h2>
        <button
          onClick={() => setAddingProject(true)}
          className="text-xs px-1.5 py-0.5 rounded"
          style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}
          title="New project"
        >
          +
        </button>
      </div>

      <button
        onClick={showAllProjects}
        className="text-xs mb-2 px-2 py-1 rounded"
        style={{
          backgroundColor: visibleProjectIds === null ? 'var(--accent)' : 'transparent',
          color: visibleProjectIds === null ? '#fff' : 'var(--text-muted)',
          border: '1px solid var(--border)',
        }}
      >
        Show All
      </button>

      <ul className="space-y-0.5 mb-1">
        {orderedProjects.map((p) => {
          const checked = visibleProjectIds === null || visibleProjectIds.has(p.id);
          const isOver = dragOverProjectId === p.id;
          const isRenaming = renamingProjectId === p.id;
          return (
            <li
              key={p.id}
              draggable={!isRenaming}
              onDragStart={() => { dragProjectId.current = p.id; }}
              onDragOver={(e) => { e.preventDefault(); setDragOverProjectId(p.id); }}
              onDrop={() => {
                const srcId = dragProjectId.current;
                if (!srcId || srcId === p.id) { setDragOverProjectId(null); return; }
                const ids = orderedProjects.map((x) => x.id);
                const si = ids.indexOf(srcId), ti = ids.indexOf(p.id);
                if (si !== -1 && ti !== -1) {
                  const next = [...ids];
                  next.splice(si, 1);
                  next.splice(ti, 0, srcId);
                  setProjectOrder(next);
                }
                dragProjectId.current = null;
                setDragOverProjectId(null);
              }}
              onDragEnd={() => { dragProjectId.current = null; setDragOverProjectId(null); }}
              style={{ borderTop: isOver ? '2px solid var(--accent)' : '2px solid transparent' }}
            >
              <div
                className="group flex items-center gap-2 text-sm py-1 px-1 rounded"
                style={{ opacity: checked ? (p.archived ? 0.5 : 1) : 0.4 }}
              >
                {/* Color swatch */}
                <label title="Change color" style={{ position: 'relative', flexShrink: 0, cursor: 'pointer' }}>
                  <span className="w-3 h-3 rounded-sm block" style={{ backgroundColor: p.color }} />
                  <input
                    type="color"
                    defaultValue={p.color}
                    onChange={(e) => updateProject.mutate({ id: p.id, data: { color: e.target.value } })}
                    style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', padding: 0, border: 'none' }}
                  />
                </label>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleProjectVisibility(p.id)}
                  className="w-3 h-3 flex-shrink-0 cursor-pointer"
                  style={{ accentColor: p.color }}
                />
                {isRenaming ? (
                  <RenameInput
                    value={p.name}
                    onCommit={(v) => { updateProject.mutate({ id: p.id, data: { name: v } }); setRenamingProjectId(null); }}
                    onCancel={() => setRenamingProjectId(null)}
                  />
                ) : (
                  <span
                    className="truncate flex-1 cursor-pointer"
                    style={{ color: 'var(--text-primary)', textDecoration: p.archived ? 'line-through' : 'none' }}
                    onClick={() => toggleProjectVisibility(p.id)}
                    onDoubleClick={() => setRenamingProjectId(p.id)}
                    title="Double-click to rename"
                  >
                    {p.name}
                  </span>
                )}
                {/* Archive toggle — visible on hover */}
                {!isRenaming && (
                  <button
                    className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-xs flex-shrink-0"
                    style={{ color: p.archived ? 'var(--accent)' : 'var(--text-muted)' }}
                    title={p.archived ? 'Unarchive' : 'Archive'}
                    onClick={(e) => { e.stopPropagation(); updateProject.mutate({ id: p.id, data: { archived: p.archived ? 0 : 1 } }); }}
                  >
                    {p.archived ? '↩' : '⊘'}
                  </button>
                )}
                <span style={{ fontSize: 10, color: 'var(--text-muted)', opacity: 0.4, flexShrink: 0, cursor: 'grab' }}>⠿</span>
              </div>
            </li>
          );
        })}
        {addingProject && (
          <NewItemForm
            placeholder="Project name…"
            defaultColor="#6366f1"
            onSave={(name, color) => { createProject.mutate({ name, color }); setAddingProject(false); }}
            onCancel={() => setAddingProject(false)}
          />
        )}
      </ul>

      {hasArchivedProjects && (
        <button
          className="text-xs mb-4 px-1 py-0.5"
          style={{ color: 'var(--text-muted)', opacity: 0.6 }}
          onClick={() => setShowArchived((v) => !v)}
        >
          {showArchived ? 'Hide archived' : 'Show archived'}
        </button>
      )}

      {/* ── People ── */}
      <div className="flex items-center justify-between mb-2 mt-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          People
        </h2>
        <button
          onClick={() => setAddingPerson(true)}
          className="text-xs px-1.5 py-0.5 rounded"
          style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}
          title="New person"
        >
          +
        </button>
      </div>

      <button
        onClick={showAllPeople}
        className="text-xs mb-2 px-2 py-1 rounded"
        style={{
          backgroundColor: visiblePersonIds === null ? 'var(--accent)' : 'transparent',
          color: visiblePersonIds === null ? '#fff' : 'var(--text-muted)',
          border: '1px solid var(--border)',
        }}
      >
        Show All
      </button>

      <ul className="space-y-0.5 mb-5">
        {orderedPeople.map((p) => {
          const checked = visiblePersonIds === null || visiblePersonIds.has(p.id);
          const isOver = dragOverId === p.id;
          const isRenaming = renamingPersonId === p.id;
          return (
            <li
              key={p.id}
              draggable={!isRenaming}
              onDragStart={() => { dragPersonId.current = p.id; }}
              onDragOver={(e) => { e.preventDefault(); setDragOverId(p.id); }}
              onDrop={() => handlePersonDrop(p.id)}
              onDragEnd={() => { dragPersonId.current = null; setDragOverId(null); }}
              style={{ borderTop: isOver ? '2px solid var(--accent)' : '2px solid transparent' }}
            >
              <div
                className="group flex items-center gap-2 text-sm py-1 px-1 rounded"
                style={{ opacity: checked ? 1 : 0.45 }}
              >
                {/* Color swatch + avatar */}
                <label title="Change color" style={{ position: 'relative', flexShrink: 0, cursor: 'pointer' }}>
                  <span
                    className="w-6 h-6 rounded-full flex items-center justify-center text-xs text-white font-medium"
                    style={{ backgroundColor: p.color }}
                  >
                    {p.avatar_initials}
                  </span>
                  <input
                    type="color"
                    defaultValue={p.color}
                    onChange={(e) => updatePerson.mutate({ id: p.id, data: { color: e.target.value } })}
                    style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', padding: 0, border: 'none' }}
                  />
                </label>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => togglePersonVisibility(p.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="w-3 h-3 flex-shrink-0 cursor-pointer"
                  style={{ accentColor: p.color }}
                />
                {isRenaming ? (
                  <RenameInput
                    value={p.name}
                    onCommit={(v) => { updatePerson.mutate({ id: p.id, data: { name: v } }); setRenamingPersonId(null); }}
                    onCancel={() => setRenamingPersonId(null)}
                  />
                ) : (
                  <span
                    className="truncate flex-1 cursor-pointer"
                    style={{ color: 'var(--text-primary)' }}
                    onClick={() => togglePersonVisibility(p.id)}
                    onDoubleClick={() => setRenamingPersonId(p.id)}
                    title="Double-click to rename"
                  >
                    {p.name}
                  </span>
                )}
                {/* Delete button — visible on hover */}
                {!isRenaming && (
                  <button
                    className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-xs flex-shrink-0"
                    style={{ color: '#ef4444' }}
                    title="Delete person"
                    onClick={(e) => {
                      e.stopPropagation();
                      deletePerson.mutate(p.id);
                    }}
                  >
                    ×
                  </button>
                )}
                <span className="ml-auto text-xs opacity-0 group-hover:opacity-40" style={{ color: 'var(--text-muted)', cursor: 'grab' }}>⠿</span>
              </div>
            </li>
          );
        })}
        {addingPerson && (
          <NewItemForm
            placeholder="Person name…"
            defaultColor="#8b5cf6"
            onSave={(name, color) => {
              const initials = name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
              createPerson.mutate({ name, color, avatar_initials: initials });
              setAddingPerson(false);
            }}
            onCancel={() => setAddingPerson(false)}
          />
        )}
      </ul>
    </aside>
  );
}
