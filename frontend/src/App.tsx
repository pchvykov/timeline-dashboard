import { useMemo, useEffect } from 'react';
import { useTasks, useProjects, usePeople } from './hooks/useTasks';
import { useUIStore } from './store/uiStore';
import { TopBar } from './components/layout/TopBar';
import { Sidebar } from './components/layout/Sidebar';
import { CustomGantt } from './components/gantt/CustomGantt';

function App() {
  const { data: tasks, isLoading: tasksLoading } = useTasks();
  const { data: projects } = useProjects();
  const { data: people } = usePeople();
  const { sidebarOpen, visibleProjectIds, visiblePersonIds, hideDoneTasks, darkMode } = useUIStore();

  // Apply dark mode class on mount
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  // Filter tasks by visible projects, people, and done status
  const filteredTasks = useMemo(() => {
    if (!tasks) return [];
    return tasks.filter((t) => {
      if (hideDoneTasks && t.status === 'done') return false;
      if (visibleProjectIds !== null && t.project_id && !visibleProjectIds.has(t.project_id)) {
        return false;
      }
      if (visiblePersonIds !== null) {
        // Show task if assignee is visible, or if unassigned (always show)
        if (t.assignee_id && !visiblePersonIds.has(t.assignee_id)) return false;
      }
      return true;
    });
  }, [tasks, visibleProjectIds, visiblePersonIds, hideDoneTasks]);

  if (tasksLoading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ color: 'var(--text-muted)' }}>
        Loading tasks...
      </div>
    );
  }

  return (
    <>
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        {sidebarOpen && <Sidebar />}
        <CustomGantt
          tasks={filteredTasks}
          projects={projects ?? []}
          people={people ?? []}
        />
      </div>
    </>
  );
}

export default App;
