import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface UIState {
  darkMode: boolean;
  toggleDarkMode: () => void;
  selectedTaskId: number | null;
  setSelectedTaskId: (id: number | null) => void;
  visibleProjectIds: Set<number> | null; // null = show all
  toggleProjectVisibility: (id: number) => void;
  showAllProjects: () => void;
  visiblePersonIds: Set<number> | null; // null = show all
  togglePersonVisibility: (id: number) => void;
  showAllPeople: () => void;
  personOrder: number[];
  setPersonOrder: (order: number[]) => void;
  projectOrder: number[];
  setProjectOrder: (order: number[]) => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  hideDoneTasks: boolean;
  toggleHideDoneTasks: () => void;
  pxPerDay: number;
  setPxPerDay: (v: number) => void;
  laneHeights: Record<string, number>;
  setLaneHeight: (laneId: string, height: number) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      darkMode: window.matchMedia('(prefers-color-scheme: dark)').matches,
      toggleDarkMode: () =>
        set((s) => {
          const next = !s.darkMode;
          document.documentElement.classList.toggle('dark', next);
          return { darkMode: next };
        }),

      selectedTaskId: null,
      setSelectedTaskId: (id) => set({ selectedTaskId: id }),

      visibleProjectIds: null,
      toggleProjectVisibility: (id) =>
        set((s) => {
          const current = s.visibleProjectIds ? new Set(s.visibleProjectIds) : null;
          if (!current) return { visibleProjectIds: new Set([id]) };
          if (current.has(id)) {
            current.delete(id);
            return { visibleProjectIds: current.size === 0 ? null : current };
          }
          current.add(id);
          return { visibleProjectIds: current };
        }),
      showAllProjects: () => set({ visibleProjectIds: null }),

      visiblePersonIds: null,
      togglePersonVisibility: (id) =>
        set((s) => {
          const current = s.visiblePersonIds ? new Set(s.visiblePersonIds) : null;
          if (!current) return { visiblePersonIds: new Set([id]) };
          if (current.has(id)) {
            current.delete(id);
            return { visiblePersonIds: current.size === 0 ? null : current };
          }
          current.add(id);
          return { visiblePersonIds: current };
        }),
      showAllPeople: () => set({ visiblePersonIds: null }),

      personOrder: [],
      setPersonOrder: (order) => set({ personOrder: order }),
      projectOrder: [],
      setProjectOrder: (order) => set({ projectOrder: order }),

      sidebarOpen: true,
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

      hideDoneTasks: true,
      toggleHideDoneTasks: () => set((s) => ({ hideDoneTasks: !s.hideDoneTasks })),

      pxPerDay: 14,
      setPxPerDay: (v) => set({ pxPerDay: Math.max(1, Math.min(80, v)) }),

      laneHeights: {},
      setLaneHeight: (laneId, height) =>
        set((s) => ({ laneHeights: { ...s.laneHeights, [laneId]: height } })),
    }),
    {
      name: 'personal-os-ui',
      storage: createJSONStorage(() => localStorage),
      // Sets aren't JSON-serializable — store as arrays and revive on load
      partialize: (s) => ({
        darkMode: s.darkMode,
        visibleProjectIds: s.visibleProjectIds ? [...s.visibleProjectIds] : null,
        visiblePersonIds: s.visiblePersonIds ? [...s.visiblePersonIds] : null,
        personOrder: s.personOrder,
        projectOrder: s.projectOrder,
        sidebarOpen: s.sidebarOpen,
        hideDoneTasks: s.hideDoneTasks,
        pxPerDay: s.pxPerDay,
        laneHeights: s.laneHeights,
      }),
      merge: (persisted: unknown, current: UIState): UIState => {
        const p = persisted as Partial<{
          darkMode: boolean;
          visibleProjectIds: number[] | null;
          visiblePersonIds: number[] | null;
          personOrder: number[];
          projectOrder: number[];
          sidebarOpen: boolean;
          hideDoneTasks: boolean;
          pxPerDay: number;
          laneHeights: Record<string, number>;
        }>;
        return {
          ...current,
          ...(p.darkMode !== undefined && { darkMode: p.darkMode }),
          visibleProjectIds: p.visibleProjectIds ? new Set(p.visibleProjectIds) : null,
          visiblePersonIds: p.visiblePersonIds ? new Set(p.visiblePersonIds) : null,
          personOrder: p.personOrder ?? [],
          projectOrder: p.projectOrder ?? [],
          ...(p.sidebarOpen !== undefined && { sidebarOpen: p.sidebarOpen }),
          ...(p.hideDoneTasks !== undefined && { hideDoneTasks: p.hideDoneTasks }),
          ...(p.pxPerDay !== undefined && { pxPerDay: p.pxPerDay }),
          laneHeights: p.laneHeights ?? {},
        };
      },
    }
  )
);
