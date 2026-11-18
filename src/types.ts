/** A pane the workspace can mount. `mount` sources stay in memory and are not saved. */
import type { PaneGroup } from "./layout/groups.ts";

export type PaneSource =
  | { kind: "html"; html: string }
  | { kind: "element"; tag: string; props?: Record<string, unknown> }
  | {
      kind: "module";
      /** Project file (`panes/app.tsx`) or a URL whose module exports `mount`. */
      url: string;
      framework?: PaneFramework;
      props?: Record<string, unknown>;
    }
  | {
      kind: "react" | "vue" | "svelte";
      component: unknown;
      props?: Record<string, unknown>;
    }
  | {
      kind: "mount";
      mount: PaneMount;
      props?: Record<string, unknown>;
    };

export type PaneFramework = "auto" | "react" | "vue" | "svelte" | "element";

export interface PaneDefinition {
  paneId: string;
  title: string;
  /** Caller-defined content type, such as `"editor"` or `"clock"`. */
  surfaceKind: string;
  source: PaneSource;
  data?: unknown;
}

export interface PaneContext {
  paneId: string;
  title: string;
  surfaceKind: string;
  data?: unknown;
  focused: boolean;
  visible: boolean;
  maximized: boolean;
  runtimeState: "live" | "frozen" | "hidden";
  presentationMode: "normal" | "overview" | "compact";
  props: Record<string, unknown>;
  /** Send a message every pane can hear. */
  emit: (type: string, detail?: unknown) => void;
  /** Subscribe to messages. The returned function removes the listener. */
  on: (type: string, listener: (event: PaneBusEvent) => void) => () => void;
}

export interface PaneBusEvent {
  type: string;
  detail: unknown;
  sourceId: string;
}

export interface PaneHandle {
  update: (context: PaneContext) => void;
  destroy: () => void;
}

export type PaneMount = (
  host: HTMLElement,
  context: PaneContext,
) => void | (() => void) | PaneHandle | Promise<void | (() => void) | PaneHandle>;

export interface Cell {
  paneId: string | null;
  reserved: boolean;
  weight: number;
}

export interface Column {
  index: number;
  widthPx: number;
  cells: Cell[];
}

export interface Plane {
  index: number;
  columns: Column[];
}

export interface Cursor {
  plane: number;
  column: number;
  row: number;
}

/** Serializable arrangement. Coordinates are stable: closing a pane does not renumber the rest. */
export interface Layout {
  schema: 1;
  workspaceId: string;
  planes: Plane[];
  cursor: Cursor;
  homePaneId: string | null;
  maximizedPaneId: string | null;
  /** Named sets of panes. A pane belongs to at most one group. */
  groups: PaneGroup[];
}

export interface Box {
  paneId: string | null;
  plane: number;
  column: number;
  row: number;
  x: number;
  y: number;
  width: number;
  height: number;
  reserved: boolean;
}

export interface Scene {
  boxes: Box[];
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export const LAYOUT_SCHEMA = 1 as const;
