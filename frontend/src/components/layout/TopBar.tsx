import { useState } from 'react';
import { useUIStore } from '../../store/uiStore';
import { useUndoStore } from '../../store/undoStore';

interface TopBarProps {
  onAutoArrange?: () => void | Promise<void>;
}

export function TopBar({ onAutoArrange }: TopBarProps) {
  const { darkMode, toggleDarkMode, toggleSidebar } = useUIStore();
  const { undoStack, redoStack, undo, redo } = useUndoStore();
  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;
  const [arranging, setArranging] = useState(false);

  const handleAutoArrange = async () => {
    if (!onAutoArrange || arranging) return;
    setArranging(true);
    try { await onAutoArrange(); } finally { setArranging(false); }
  };

  return (
    <header
      className="h-11 flex items-center justify-between px-3 border-b flex-shrink-0"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-elevated)' }}
    >
      <div className="flex items-center gap-2">
        <button onClick={toggleSidebar} className="btn-icon" title="Toggle sidebar">
          &#9776;
        </button>
        <span className="font-medium text-sm" style={{ color: 'var(--text-primary)', opacity: 0.85 }}>
          Timeline
        </span>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={handleAutoArrange}
          disabled={arranging}
          className="btn-ghost"
          title="Auto-arrange tasks per lane (iterative row packer)"
          style={{ opacity: arranging ? 0.5 : 1 }}
        >
          {arranging ? '⟳ Arranging…' : '⊞ Auto-arrange'}
        </button>
        <button
          onClick={undo}
          disabled={!canUndo}
          className="btn-ghost"
          title={canUndo ? `Undo: ${undoStack[undoStack.length - 1]?.label}` : 'Nothing to undo (⌘Z)'}
        >
          ↩ Undo
        </button>
        <button
          onClick={redo}
          disabled={!canRedo}
          className="btn-ghost"
          title={canRedo ? `Redo: ${redoStack[redoStack.length - 1]?.label}` : 'Nothing to redo (⌘⇧Z)'}
        >
          ↪ Redo
        </button>
        <button onClick={toggleDarkMode} className="btn-icon" title="Toggle dark mode" style={{ fontSize: '0.9rem' }}>
          {darkMode ? '☀︎' : '◑'}
        </button>
      </div>
    </header>
  );
}
