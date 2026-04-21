import { useUIStore } from '../../store/uiStore';
import { useUndoStore } from '../../store/undoStore';

export function TopBar() {
  const { darkMode, toggleDarkMode, toggleSidebar } = useUIStore();
  const { undoStack, redoStack, undo, redo } = useUndoStore();
  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;

  return (
    <header
      className="h-12 flex items-center justify-between px-4 border-b flex-shrink-0"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-elevated)' }}
    >
      <div className="flex items-center gap-3">
        <button
          onClick={toggleSidebar}
          className="text-lg"
          style={{ color: 'var(--text-muted)' }}
          title="Toggle sidebar"
        >
          &#9776;
        </button>
        <span className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>
          Timeline Dashboard
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={undo}
          disabled={!canUndo}
          className="px-2 py-1 rounded text-sm"
          style={{
            color: canUndo ? 'var(--text-primary)' : 'var(--text-muted)',
            border: '1px solid var(--border)',
            opacity: canUndo ? 1 : 0.4,
          }}
          title={canUndo ? `Undo: ${undoStack[undoStack.length - 1]?.label}` : 'Nothing to undo (⌘Z)'}
        >
          ↩ Undo
        </button>
        <button
          onClick={redo}
          disabled={!canRedo}
          className="px-2 py-1 rounded text-sm"
          style={{
            color: canRedo ? 'var(--text-primary)' : 'var(--text-muted)',
            border: '1px solid var(--border)',
            opacity: canRedo ? 1 : 0.4,
          }}
          title={canRedo ? `Redo: ${redoStack[redoStack.length - 1]?.label}` : 'Nothing to redo (⌘⇧Z)'}
        >
          ↪ Redo
        </button>
        <button
          onClick={toggleDarkMode}
          className="px-2 py-1 rounded text-sm"
          style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}
          title="Toggle dark mode"
        >
          {darkMode ? 'Light' : 'Dark'}
        </button>
      </div>
    </header>
  );
}
