declare module 'wx-react-gantt' {
  import { ComponentType, RefObject } from 'react';

  interface GanttTask {
    id: number;
    text: string;
    start: Date;
    end: Date;
    progress?: number;
    parent?: number;
    type?: 'task' | 'milestone' | 'summary';
    open?: boolean;
    [key: string]: any;
  }

  interface GanttLink {
    id: number;
    source: number;
    target: number;
    type: 'e2s' | 'e2e' | 's2s' | 's2e';
  }

  interface GanttScale {
    unit: 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';
    step: number;
    format: string;
  }

  interface GanttColumn {
    id: string;
    header: string;
    width?: number;
    flexgrow?: number;
  }

  interface GanttProps {
    tasks: GanttTask[];
    links?: GanttLink[];
    scales?: GanttScale[];
    columns?: GanttColumn[];
    cellWidth?: number;
    cellHeight?: number;
    onAction?: (action: any) => void;
    ref?: RefObject<any>;
  }

  export const Gantt: ComponentType<GanttProps>;
  export const Willow: ComponentType<{ children: React.ReactNode }>;
  export const WillowDark: ComponentType<{ children: React.ReactNode }>;
  export const Toolbar: ComponentType<any>;
  export const ContextMenu: ComponentType<any>;
  export const defaultColumns: GanttColumn[];
  export const defaultToolbarButtons: any[];
}

declare module 'wx-react-gantt/dist/gantt.css';
