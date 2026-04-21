import { create } from 'zustand';

export interface UndoAction {
  label: string;
  undo: () => void;
  redo: () => void;
}

interface UndoState {
  undoStack: UndoAction[];
  redoStack: UndoAction[];
  push: (action: UndoAction) => void;
  undo: () => void;
  redo: () => void;
}

export const useUndoStore = create<UndoState>((set, get) => ({
  undoStack: [],
  redoStack: [],

  push: (action) =>
    set((s) => ({
      undoStack: [...s.undoStack.slice(-49), action],
      redoStack: [],
    })),

  undo: () => {
    const { undoStack, redoStack } = get();
    const action = undoStack[undoStack.length - 1];
    if (!action) return;
    action.undo();
    set({ undoStack: undoStack.slice(0, -1), redoStack: [...redoStack, action] });
  },

  redo: () => {
    const { undoStack, redoStack } = get();
    const action = redoStack[redoStack.length - 1];
    if (!action) return;
    action.redo();
    set({ undoStack: [...undoStack, action], redoStack: redoStack.slice(0, -1) });
  },
}));
