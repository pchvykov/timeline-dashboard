import { useEffect, useRef } from 'react';
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
  const { detailPanelWidth, setDetailPanelWidth } = useUIStore();

  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedTaskId(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setSelectedTaskId]);

  // Global mouse events for panel resize
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const dx = startX.current - e.clientX;
      setDetailPanelWidth(startWidth.current + dx);
    };
    const onMouseUp = () => { isResizing.current = false; };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [setDetailPanelWidth]);

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
      {/* Panel */}
      <div
        style={{
          position: 'relative',
          zIndex: 101,
          height: '100%',
          width: detailPanelWidth,
          overflowY: 'auto',
          pointerEvents: 'auto',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.2)',
          flexShrink: 0,
        }}
      >
        {/* Resize handle on left edge */}
        <div
          onMouseDown={(e) => {
            e.preventDefault();
            isResizing.current = true;
            startX.current = e.clientX;
            startWidth.current = detailPanelWidth;
          }}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 5,
            cursor: 'ew-resize',
            zIndex: 10,
            backgroundColor: 'transparent',
            transition: 'background-color 0.15s',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--accent)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
        />
        <TaskDetailPanel task={task} projects={projects} people={people} />
      </div>
    </div>
  );
}
