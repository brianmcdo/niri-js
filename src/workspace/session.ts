import { closePane as closeInLayout, assertLayout } from "../layout/layout.ts";
import type { Cursor, Layout, PaneDefinition, PaneSource } from "../types.ts";

export const SESSION_SCHEMA = 2 as const;

export interface ClosedRecord {
  pane: PaneDefinition;
  cursor: Cursor;
  groupId: string | null;
}

export interface WorkspaceSnapshot {
  id: string;
  name: string;
  layout: Layout;
  panes: PaneDefinition[];
}

export interface SessionDocument {
  schema: typeof SESSION_SCHEMA;
  activeId: string;
  workspaces: WorkspaceSnapshot[];
  closed: ClosedRecord[];
}

const CLOSED_LIMIT = 12;

export function pushClosed(closed: readonly ClosedRecord[], record: ClosedRecord): ClosedRecord[] {
  return [record, ...closed.filter((item) => item.pane.paneId !== record.pane.paneId)].slice(0, CLOSED_LIMIT);
}

export function workspaceIdFor(name: string, taken: ReadonlySet<string>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace";
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export function parseSession(raw: string): SessionDocument | null {
  try {
    return normalizeSession(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Read a saved session, including the older single-strip file. */
export function normalizeSession(value: unknown): SessionDocument | null {
  if (!value || typeof value !== "object") return null;
  const data = value as {
    schema?: number;
    layout?: unknown;
    panes?: unknown;
    activeId?: unknown;
    workspaces?: unknown;
    closed?: unknown;
  };
  if (data.schema === 1) {
    const snapshot = snapshotFrom(data.layout, data.panes, "main", "Main");
    if (!snapshot) return null;
    return { schema: SESSION_SCHEMA, activeId: snapshot.id, workspaces: [snapshot], closed: [] };
  }
  if (data.schema !== SESSION_SCHEMA || !Array.isArray(data.workspaces)) return null;
  const workspaces: WorkspaceSnapshot[] = [];
  const seen = new Set<string>();
  for (const item of data.workspaces) {
    if (!item || typeof item !== "object") continue;
    const record = item as Partial<WorkspaceSnapshot>;
    const snapshot = snapshotFrom(record.layout, record.panes, record.id, record.name);
    if (!snapshot || seen.has(snapshot.id)) continue;
    seen.add(snapshot.id);
    workspaces.push(snapshot);
  }
  if (workspaces.length === 0) return null;
  const activeId =
    typeof data.activeId === "string" && seen.has(data.activeId) ? data.activeId : workspaces[0]!.id;
  return { schema: SESSION_SCHEMA, activeId, workspaces, closed: normalizeClosed(data.closed) };
}

/** A downloaded layout, or a whole session. The active strip is the one to load. */
export function parseLayoutFile(raw: string): { layout: Layout; panes: PaneDefinition[] } | null {
  const session = parseSession(raw);
  if (!session) return null;
  const active = session.workspaces.find((item) => item.id === session.activeId) ?? session.workspaces[0];
  if (!active) return null;
  return { layout: active.layout, panes: active.panes };
}

export function exportDocument(snapshot: WorkspaceSnapshot): string {
  const document: SessionDocument = {
    schema: SESSION_SCHEMA,
    activeId: snapshot.id,
    workspaces: [serializableSnapshot(snapshot)],
    closed: [],
  };
  return JSON.stringify(document, null, 2);
}

export function serializableSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  let layout = snapshot.layout;
  const panes: PaneDefinition[] = [];
  for (const pane of snapshot.panes) {
    if (!serializableSource(pane.source)) {
      layout = closeInLayout(layout, pane.paneId);
      continue;
    }
    panes.push(pane);
  }
  return { ...snapshot, layout, panes };
}

export function serializableSource(source: PaneSource): boolean {
  return source.kind === "html" || source.kind === "element" || source.kind === "module";
}

function snapshotFrom(
  layout: unknown,
  panes: unknown,
  id: unknown,
  name: unknown,
): WorkspaceSnapshot | null {
  if (!layout) return null;
  try {
    assertLayout(layout);
  } catch {
    return null;
  }
  const workspaceId = typeof id === "string" && id.trim() ? slug(id) : slug(layout.workspaceId || "main");
  const workspaceName = typeof name === "string" && name.trim() ? name.trim().slice(0, 40) : "Main";
  return {
    id: workspaceId,
    name: workspaceName,
    layout,
    panes: filterPanes(panes),
  };
}

function normalizeClosed(value: unknown): ClosedRecord[] {
  if (!Array.isArray(value)) return [];
  const closed: ClosedRecord[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Partial<ClosedRecord>;
    if (!isPane(record.pane) || !serializableSource(record.pane.source) || !isCursor(record.cursor)) continue;
    closed.push({
      pane: record.pane,
      cursor: record.cursor,
      groupId: typeof record.groupId === "string" ? record.groupId : null,
    });
    if (closed.length === CLOSED_LIMIT) break;
  }
  return closed;
}

function filterPanes(value: unknown): PaneDefinition[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is PaneDefinition => isPane(item) && serializableSource(item.source));
}

function isPane(value: unknown): value is PaneDefinition {
  if (!value || typeof value !== "object") return false;
  const pane = value as Partial<PaneDefinition>;
  return typeof pane.paneId === "string" && typeof pane.title === "string" && typeof pane.surfaceKind === "string" && !!pane.source;
}

function isCursor(value: unknown): value is Cursor {
  if (!value || typeof value !== "object") return false;
  const cursor = value as Partial<Cursor>;
  return integer(cursor.plane) && integer(cursor.column) && integer(cursor.row);
}

function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace";
}
