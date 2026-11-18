import type { Layout } from "./types.ts";

export interface PaneGroup {
  id: string;
  name: string;
  color: string;
  paneIds: string[];
}

const colors = ["#e0a15a", "#7dba9a", "#7aa2d6", "#d68a9a", "#b79ad4"];

export function groupColor(index: number): string {
  return colors[index % colors.length] ?? colors[0]!;
}

/** Keep saved groups that still point at real panes, and let each pane belong to one group. */
export function normalizeGroups(value: unknown, validIds?: ReadonlySet<string>): PaneGroup[] {
  if (!Array.isArray(value)) return [];
  const seenPanes = new Set<string>();
  const seenIds = new Set<string>();
  const groups: PaneGroup[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const group = item as Partial<PaneGroup>;
    if (typeof group.id !== "string" || typeof group.name !== "string") continue;
    const id = group.id.trim();
    const name = group.name.trim().slice(0, 40);
    if (!id || !name || seenIds.has(id)) continue;
    const paneIds = Array.isArray(group.paneIds)
      ? group.paneIds.filter((paneId): paneId is string => {
          if (typeof paneId !== "string" || seenPanes.has(paneId)) return false;
          if (validIds && !validIds.has(paneId)) return false;
          seenPanes.add(paneId);
          return true;
        })
      : [];
    if (paneIds.length === 0) continue;
    seenIds.add(id);
    groups.push({
      id,
      name,
      color: typeof group.color === "string" && group.color ? group.color : groupColor(groups.length),
      paneIds,
    });
  }
  return groups;
}

export function groupOf(groups: readonly PaneGroup[], paneId: string): PaneGroup | undefined {
  return groups.find((group) => group.paneIds.includes(paneId));
}

export function addPaneToGroup(groups: readonly PaneGroup[], name: string, paneId: string): PaneGroup[] {
  const trimmed = name.trim().slice(0, 40);
  if (!trimmed || !paneId) return [...groups];
  const existing = groups.find((group) => group.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return assignPane(groups, paneId, existing.id);
  const taken = new Set(groups.map((group) => group.id));
  let id = slug(trimmed);
  let n = 2;
  while (taken.has(id)) {
    id = `${slug(trimmed)}-${n}`;
    n += 1;
  }
  return [
    ...ungroupPane(groups, paneId),
    { id, name: trimmed, color: groupColor(groups.length), paneIds: [paneId] },
  ];
}

export function assignPane(groups: readonly PaneGroup[], paneId: string, groupId: string): PaneGroup[] {
  if (!groups.some((group) => group.id === groupId)) return [...groups];
  return groups
    .map((group) => {
      const paneIds = group.paneIds.filter((id) => id !== paneId);
      if (group.id === groupId) paneIds.push(paneId);
      return { ...group, paneIds };
    })
    .filter((group) => group.paneIds.length > 0);
}

export function ungroupPane(groups: readonly PaneGroup[], paneId: string): PaneGroup[] {
  return groups
    .map((group) => ({ ...group, paneIds: group.paneIds.filter((id) => id !== paneId) }))
    .filter((group) => group.paneIds.length > 0);
}

export const forgetPane = ungroupPane;

export function spatialPaneIds(layout: Layout): string[] {
  const ids: string[] = [];
  const planes = [...layout.planes].sort((left, right) => left.index - right.index);
  for (const plane of planes) {
    const columns = [...plane.columns].sort((left, right) => left.index - right.index);
    for (const column of columns) {
      for (const cell of column.cells) {
        if (cell.paneId) ids.push(cell.paneId);
      }
    }
  }
  return ids;
}

export function orderedMembers(layout: Layout, group: PaneGroup): string[] {
  const members = new Set(group.paneIds);
  return spatialPaneIds(layout).filter((id) => members.has(id));
}

/** The pane `delta` steps away inside the group, in strip order. */
export function cycleMember(layout: Layout, groupId: string, currentId: string | null, delta: number): string | null {
  const group = layout.groups.find((item) => item.id === groupId);
  if (!group || delta === 0) return currentId;
  const members = orderedMembers(layout, group);
  if (members.length === 0) return null;
  const index = members.indexOf(currentId ?? "");
  const start = index < 0 ? (delta > 0 ? -1 : 0) : index;
  const next = (start + delta) % members.length;
  return members[next < 0 ? next + members.length : next] ?? null;
}

export function withGroups(layout: Layout, groups: readonly PaneGroup[]): Layout {
  const next = structuredClone(layout);
  next.groups = groups.map((group) => ({ ...group, paneIds: [...group.paneIds] }));
  return next;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "group";
}
