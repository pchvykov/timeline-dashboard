import { useEffect } from 'react';
import type { Task, Project, Person } from '../../lib/api';
import { TaskDetailPanel } from './TaskDetailPanel';
import { useUIStore } from '../../store/uiStore';

interface Props {
  task: Task;
  projects: Project[];
  people: Person[];
}

export function TaskDetailModal({ task, projects, people }: Props) {
  const setSelectedTaskId = useUIStore((s) => s.setSelectedTaskId);

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedTaskId(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setSelectedTaskId]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'flex-end',
        pointerEvents: 'none',
      }}
    >
      {/* Semi-transparent backdrop */}
      <div
        onClick={() => setSelectedTaskId(null)}
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.25)',
          pointerEvents: 'auto',
        }}
      />
      {/* Panel - positioned on right side */}
      <div
        style={{
          position: 'relative',
          zIndex: 101,
          height: '100%',
          width: 360,
          overflowY: 'auto',
          pointerEvents: 'auto',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.2)',
        }}
      >
        <TaskDetailPanel task={task} projects={projects} people={people} />
      </div>
    </div>
  );
}
