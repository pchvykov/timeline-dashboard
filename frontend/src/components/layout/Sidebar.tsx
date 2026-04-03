import { useRef, useState, useCallback } from 'react';
import { useProjects, usePeople, useUpdateProject } from '../../hooks/useTasks';
import { useUIStore } from '../../store/uiStore';

export function Sidebar() {
  const { data: projects } = useProjects();
  const { data: people } = usePeople();
  const updateProject = useUpdateProject();
  const {
    visibleProjectIds, toggleProjectVisibility, showAllProjects,
    visiblePersonIds, togglePersonVisibility, showAllPeople,
    personOrder, setPersonOrder,
    projectOrder, setProjectOrder,
  } = useUIStore();

  // ── Project drag-to-reorder ────────────────────────────────────────────────
  const dragProjectId = useRef<number | null>(null);
  const [dragOverProjectId, setDragOverProjectId] = useState<number | null>(null);

  const orderedProjects = (() => {
    if (!projects) return [];
    if (projectOrder.length === 0) return projects;
    const byId = Object.fromEntries(projects.map((p) => [p.id, p]));
    const ordered = projectOrder.map((id) => byId[id]).filter(Boolean);
    const inOrder = new Set(projectOrder);
    projects.forEach((p) => { if (!inOrder.has(p.id)) ordered.push(p); });
    return ordered;
  })();

  // ── People drag-to-reorder ─────────────────────────────────────────────────
  const dragPersonId = useRef<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);

  // Build ordered people list
  const orderedPeople = (() => {
    if (!people) return [];
    if (personOrder.length === 0) return people;
    const byId = Object.fromEntries(people.map((p) => [p.id, p]));
    const ordered = personOrder.map((id) => byId[id]).filter(Boolean);
    // Append any new people not yet in the order
    const inOrder = new Set(personOrder);
    people.forEach((p) => { if (!inOrder.has(p.id)) ordered.push(p); });
    return ordered;
  })();

  const handlePersonDragStart = useCallback((id: number) => {
    dragPersonId.current = id;
  }, []);

  const handlePersonDragOver = useCallback((e: React.DragEvent, id: number) => {
    e.preventDefault();
    setDragOverId(id);
  }, []);

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

  const handlePersonDragEnd = useCallback(() => {
    dragPersonId.current = null;
    setDragOverId(null);
  }, []);

  return (
    <aside
      className="w-60 flex-shrink-0 border-r overflow-y-auto p-4"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)' }}
    >
      {/* ── Projects ── */}
      <h2 className="text-sm font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
        Projects
      </h2>
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
      <ul className="space-y-0.5 mb-5">
        {orderedProjects.map((p) => {
          const checked = visibleProjectIds === null || visibleProjectIds.has(p.id);
          const isOver = dragOverProjectId === p.id;
          return (
            <li
              key={p.id}
              draggable
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
                className="flex items-center gap-2 text-sm py-1 px-1 rounded"
                style={{ opacity: checked ? 1 : 0.45 }}
              >
                {/* Color swatch — clicking opens native color picker */}
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
                <span className="truncate flex-1 cursor-pointer" style={{ color: 'var(--text-primary)' }}
                  onClick={() => toggleProjectVisibility(p.id)}>
                  {p.name}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', opacity: 0.4, flexShrink: 0, cursor: 'grab' }}>⠿</span>
              </div>
            </li>
          );
        })}
      </ul>

      {/* ── People ── */}
      <h2 className="text-sm font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
        People
      </h2>
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
          return (
            <li
              key={p.id}
              draggable
              onDragStart={() => handlePersonDragStart(p.id)}
              onDragOver={(e) => handlePersonDragOver(e, p.id)}
              onDrop={() => handlePersonDrop(p.id)}
              onDragEnd={handlePersonDragEnd}
              style={{
                borderTop: isOver ? '2px solid var(--accent)' : '2px solid transparent',
                cursor: 'grab',
                opacity: checked ? 1 : 0.45,
              }}
            >
              <label className="flex items-center gap-2 text-sm cursor-pointer py-1 px-1 rounded">
                <span
                  className="w-6 h-6 rounded-full flex items-center justify-center text-xs text-white font-medium flex-shrink-0"
                  style={{ backgroundColor: p.color }}
                >
                  {p.avatar_initials}
                </span>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => togglePersonVisibility(p.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="w-3 h-3 flex-shrink-0 cursor-pointer"
                  style={{ accentColor: p.color }}
                />
                <span className="truncate" style={{ color: 'var(--text-primary)' }}>
                  {p.name}
                </span>
                <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)', opacity: 0.4 }}>⠿</span>
              </label>
            </li>
          );
        })}
      </ul>

    </aside>
  );
}
