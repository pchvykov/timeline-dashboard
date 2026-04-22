import { useMemo, useEffect, useRef } from 'react';
import { useTasks, useProjects, usePeople } from './hooks/useTasks';
import { useUIStore } from './store/uiStore';
import { useUndoStore } from './store/undoStore';
import { TopBar } from './components/layout/TopBar';
import { Sidebar } from './components/layout/Sidebar';
import { CustomGantt } from './components/gantt/CustomGantt';

function App() {
  const { data: tasks, isLoading: tasksLoading } = useTasks();
  const { data: projects } = useProjects();
  const { data: people } = usePeople();
  const { sidebarOpen, visibleProjectIds, visiblePersonIds, darkMode } = useUIStore();
  const { undo, redo } = useUndoStore();
  const autoArrangeRef = useRef<(() => Promise<void>) | null>(null);

  // Apply dark mode class on mount
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  // Global undo/redo keyboard shortcut
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== 'z') return;
      // Ignore when focus is in a text input/textarea so normal undo still works there
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

  // Filter tasks by visible projects and people.
  // Done tasks are never filtered out — they stay on the timeline with muted styling.
  const filteredTasks = useMemo(() => {
    if (!tasks) return [];
    return tasks.filter((t) => {
      if (visibleProjectIds !== null && t.project_id && !visibleProjectIds.has(t.project_id)) {
        return false;
      }
      if (visiblePersonIds !== null) {
        if (t.assignee_id && !visiblePersonIds.has(t.assignee_id)) return false;
      }
      return true;
    });
  }, [tasks, visibleProjectIds, visiblePersonIds]);

  if (tasksLoading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ color: 'var(--text-muted)' }}>
        Loading tasks...
      </div>
    );
  }

  return (
    <>
      <TopBar onAutoArrange={() => autoArrangeRef.current?.()} />
      <div className="flex flex-1 overflow-hidden">
        {sidebarOpen && <Sidebar />}
        <CustomGantt
          tasks={filteredTasks}
          projects={projects ?? []}
          people={people ?? []}
          autoArrangeRef={autoArrangeRef}
        />
      </div>
    </>
  );
}

export default App;
