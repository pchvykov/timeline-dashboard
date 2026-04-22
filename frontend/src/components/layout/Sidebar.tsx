import { useRef, useState, useCallback, useEffect } from 'react';
import {
  useProjects, usePeople,
  useUpdateProject, useCreateProject,
  useUpdatePerson, useCreatePerson, useDeletePerson,
} from '../../hooks/useTasks';
import { useUIStore } from '../../store/uiStore';

const PROJECT_COLORS = [
  '#5CAAED', '#E99202', '#009E73', '#CC79A7', '#F3B817',
  '#8062EB', '#00AAE3', '#D85202', '#89BD00', '#E76F92',
  '#85C4F2', '#009FB0', '#9664E6', '#C97F02', '#0066BC',
];

// ── Color picker popover with preset swatches ─────────────────────────────────
function ColorPickerPopover({
  color,
  shape = 'square',
  children,
  onChange,
}: {
  color: string;
  shape?: 'square' | 'circle';
  children: React.ReactNode;
  onChange: (c: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const isPreset = PROJECT_COLORS.includes(color);

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <div
        title="Change color"
        style={{ cursor: 'pointer' }}
        onClick={() => setOpen((v) => !v)}
      >
        {children}
      </div>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 200,
            backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: 6,
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 16px)',
            gap: 4,
            marginTop: 3,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {PROJECT_COLORS.map((c) => (
            <div
              key={c}
              style={{
                width: 16,
                height: 16,
                borderRadius: shape === 'circle' ? '50%' : 3,
                backgroundColor: c,
                cursor: 'pointer',
                outline: c === color ? '2px solid var(--text-primary)' : 'none',
                outlineOffset: 1,
              }}
              onClick={() => { onChange(c); setOpen(false); }}
            />
          ))}
          <label
            title="Custom color"
            style={{ position: 'relative', cursor: 'pointer', width: 16, height: 16 }}
          >
            <div
              style={{
                width: 16,
                height: 16,
                borderRadius: shape === 'circle' ? '50%' : 3,
                backgroundColor: isPreset ? 'var(--bg-surface)' : color,
                border: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                color: 'var(--text-muted)',
              }}
            >
              +
            </div>
            <input
              type="color"
              value={color}
              onChange={(e) => onChange(e.target.value)}
              style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', padding: 0, border: 'none' }}
            />
          </label>
        </div>
      )}
    </div>
  );
}

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
      <ColorPickerPopover color={color} onChange={setColor}>
        <span className="w-3 h-3 rounded-sm block" style={{ backgroundColor: color }} />
      </ColorPickerPopover>
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
      className="w-56 flex-shrink-0 border-r overflow-y-auto py-4 px-3"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)' }}
    >
      {/* ── Projects ── */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-semibold tracking-wider uppercase" style={{ color: 'var(--text-muted)', opacity: 0.7 }}>
          Projects
        </span>
        <button onClick={() => setAddingProject(true)} className="btn-icon" style={{ width: 20, height: 20, fontSize: '1rem' }} title="New project">
          +
        </button>
      </div>

      <button
        onClick={showAllProjects}
        className={`btn-ghost text-xs mb-2 ${visibleProjectIds === null ? 'active' : ''}`}
        style={{ padding: '2px 8px', borderRadius: 999 }}
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
                className="group flex items-center gap-2 text-sm py-1 px-2 rounded-md"
                style={{
                  opacity: checked ? (p.archived ? 0.5 : 1) : 0.4,
                  transition: 'background-color 0.1s',
                  cursor: 'default',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(128,128,128,0.08)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
              >
                {/* Color swatch */}
                <ColorPickerPopover color={p.color} onChange={(c) => updateProject.mutate({ id: p.id, data: { color: c } })}>
                  <span className="w-3 h-3 rounded-sm block" style={{ backgroundColor: p.color }} />
                </ColorPickerPopover>
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
                    className="truncate flex-1 cursor-pointer text-xs"
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
                    className="opacity-0 group-hover:opacity-60 hover:!opacity-100 btn-icon flex-shrink-0"
                    style={{ width: 16, height: 16, fontSize: '0.7rem', color: p.archived ? 'var(--accent)' : 'var(--text-muted)' }}
                    title={p.archived ? 'Unarchive' : 'Archive'}
                    onClick={(e) => { e.stopPropagation(); updateProject.mutate({ id: p.id, data: { archived: p.archived ? 0 : 1 } }); }}
                  >
                    {p.archived ? '↩' : '⊘'}
                  </button>
                )}
                <span style={{ fontSize: 9, color: 'var(--text-muted)', opacity: 0.35, flexShrink: 0, cursor: 'grab' }}>⠿</span>
              </div>
            </li>
          );
        })}
        {addingProject && (
          <NewItemForm
            placeholder="Project name…"
            defaultColor={PROJECT_COLORS[orderedProjects.length % PROJECT_COLORS.length]}
            onSave={(name, color) => { createProject.mutate({ name, color }); setAddingProject(false); }}
            onCancel={() => setAddingProject(false)}
          />
        )}
      </ul>

      {hasArchivedProjects && (
        <button
          className="btn-ghost text-xs mb-4"
          style={{ padding: '2px 6px', opacity: 0.6 }}
          onClick={() => setShowArchived((v) => !v)}
        >
          {showArchived ? 'Hide archived' : 'Show archived'}
        </button>
      )}

      {/* ── People ── */}
      <div className="flex items-center justify-between mb-1.5 mt-3">
        <span className="text-xs font-semibold tracking-wider uppercase" style={{ color: 'var(--text-muted)', opacity: 0.7 }}>
          People
        </span>
        <button onClick={() => setAddingPerson(true)} className="btn-icon" style={{ width: 20, height: 20, fontSize: '1rem' }} title="New person">
          +
        </button>
      </div>

      <button
        onClick={showAllPeople}
        className={`btn-ghost text-xs mb-2 ${visiblePersonIds === null ? 'active' : ''}`}
        style={{ padding: '2px 8px', borderRadius: 999 }}
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
                className="group flex items-center gap-2 py-1 px-2 rounded-md"
                style={{
                  opacity: checked ? 1 : 0.4,
                  transition: 'background-color 0.1s',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(128,128,128,0.08)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
              >
                {/* Color swatch + avatar */}
                <ColorPickerPopover color={p.color} shape="circle" onChange={(c) => updatePerson.mutate({ id: p.id, data: { color: c } })}>
                  <span
                    className="w-5 h-5 rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0"
                    style={{ backgroundColor: p.color, fontSize: 9 }}
                  >
                    {p.avatar_initials}
                  </span>
                </ColorPickerPopover>
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
                    className="truncate flex-1 cursor-pointer text-xs"
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
                    className="opacity-0 group-hover:opacity-60 hover:!opacity-100 btn-icon flex-shrink-0"
                    style={{ width: 16, height: 16, fontSize: '0.85rem', color: 'var(--urgent)' }}
                    title="Delete person"
                    onClick={(e) => { e.stopPropagation(); deletePerson.mutate(p.id); }}
                  >
                    ×
                  </button>
                )}
                <span className="opacity-0 group-hover:opacity-35 flex-shrink-0" style={{ fontSize: 9, color: 'var(--text-muted)', cursor: 'grab' }}>⠿</span>
              </div>
            </li>
          );
        })}
        {addingPerson && (
          <NewItemForm
            placeholder="Person name…"
            defaultColor={PROJECT_COLORS[0]}
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
