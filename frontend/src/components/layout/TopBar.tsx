import { useUIStore } from '../../store/uiStore';

export function TopBar() {
  const { darkMode, toggleDarkMode, toggleSidebar } = useUIStore();

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

      <div className="flex items-center gap-3">
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
