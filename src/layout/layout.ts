import type {
  Box,
  Cell,
  Column,
  Cursor,
  Layout,
  Plane,
  Scene,
  Viewport,
} from "../types.ts";
import { LAYOUT_SCHEMA } from "../types.ts";
import { forgetPane, normalizeGroups } from "./groups.ts";

export interface MeasureOptions {
  gap: number;
  padding: number;
  /** Width used for an empty column slot. */
  emptyWidth: number;
}

export interface SeedColumn {
  paneIds: readonly string[];
  widthPx?: number;
}

const MIN_COLUMN_WIDTH = 280;
const MAX_COLUMN_WIDTH = 1440;
const MIN_WEIGHT = 0.15;

export function defaultColumnWidth(viewportWidth: number): number {
  return Math.round(Math.min(680, Math.max(400, viewportWidth * 0.56)));
}

export function createLayout(
  workspaceId: string,
  columns: readonly SeedColumn[],
  columnWidth: number,
): Layout {
  const width = clampWidth(columnWidth);
  const plane: Plane = {
    index: 0,
    columns: columns.map((column, index) => ({
      index,
      widthPx: clampWidth(column.widthPx ?? width),
      cells: column.paneIds.map((paneId) => cell(paneId)),
    })),
  };
  const first = plane.columns[0]?.cells[0]?.paneId ?? null;
  return {
    schema: LAYOUT_SCHEMA,
    workspaceId,
    planes: plane.columns.length > 0 ? [plane] : [],
    cursor: { plane: 0, column: 0, row: 0 },
    homePaneId: first,
    maximizedPaneId: null,
    groups: [],
  };
}

export function assertLayout(value: unknown): asserts value is Layout {
  if (!value || typeof value !== "object") throw new Error("Layout must be an object.");
  const layout = value as Partial<Layout>;
  if (layout.schema !== LAYOUT_SCHEMA) {
    throw new Error(`Layout schema ${String(layout.schema)} is not supported.`);
  }
  if (!Array.isArray(layout.planes) || !layout.cursor) {
    throw new Error("Layout is missing planes or a cursor.");
  }
  const seen = new Set<string>();
  for (const plane of layout.planes) {
    if (typeof plane.index !== "number" || !Array.isArray(plane.columns)) {
      throw new Error("Layout plane is invalid.");
    }
    for (const column of plane.columns) {
      if (typeof column.index !== "number" || typeof column.widthPx !== "number") {
        throw new Error("Layout column is invalid.");
      }
      if (!Array.isArray(column.cells) || column.cells.length === 0) {
        throw new Error("Layout column has no cells.");
      }
      for (const item of column.cells) {
        if (typeof item.weight !== "number" || typeof item.reserved !== "boolean") {
          throw new Error("Layout cell is invalid.");
        }
        if (item.paneId !== null) {
          if (typeof item.paneId !== "string" || seen.has(item.paneId)) {
            throw new Error(`Duplicate or invalid pane id ${String(item.paneId)}.`);
          }
          seen.add(item.paneId);
        }
      }
    }
  }
  assertCursor(layout.cursor);
  const layoutWithGroups = layout as Layout;
  layoutWithGroups.groups = normalizeGroups(layout.groups, seen);
}

export function paneIds(layout: Layout): string[] {
  const ids: string[] = [];
  for (const plane of layout.planes) {
    for (const column of plane.columns) {
      for (const item of column.cells) {
        if (item.paneId) ids.push(item.paneId);
      }
    }
  }
  return ids;
}

export function findCursor(layout: Layout, paneId: string): Cursor | null {
  for (const plane of layout.planes) {
    for (const column of plane.columns) {
      const row = column.cells.findIndex((item) => item.paneId === paneId);
      if (row >= 0) return { plane: plane.index, column: column.index, row };
    }
  }
  return null;
}

export function openPane(layout: Layout, paneId: string, columnWidth: number): Layout {
  const next = clone(layout);
  const spot = cellAt(next, next.cursor);
  if (spot && spot.paneId === null) {
    spot.paneId = paneId;
    spot.reserved = false;
    next.maximizedPaneId = null;
    return next;
  }

  const plane = ensurePlane(next, next.cursor.plane);
  const column = columnAt(plane, next.cursor.column);
  if (!column) {
    plane.columns.push({
      index: next.cursor.column,
      widthPx: clampWidth(columnWidth),
      cells: [cell(paneId)],
    });
    next.cursor = { ...next.cursor, row: 0 };
  } else if (next.cursor.row === column.cells.length) {
    column.cells.push(cell(paneId));
  } else {
    const index = next.cursor.column + 1;
    shiftColumns(plane, index, 1);
    plane.columns.push({
      index,
      widthPx: clampWidth(columnWidth),
      cells: [cell(paneId)],
    });
    next.cursor = { plane: plane.index, column: index, row: 0 };
  }
  next.maximizedPaneId = null;
  if (!next.homePaneId) next.homePaneId = paneId;
  return next;
}

/** Put a pane back where it was. A missing column is recreated; a live column gains the cell at that row. */
export function openPaneAt(layout: Layout, paneId: string, at: Cursor, columnWidth: number): Layout {
  const next = clone(layout);
  const plane = ensurePlane(next, at.plane);
  const column = columnAt(plane, at.column);
  if (!column) {
    plane.columns.push({
      index: at.column,
      widthPx: clampWidth(columnWidth),
      cells: [cell(paneId)],
    });
    next.cursor = { plane: plane.index, column: at.column, row: 0 };
  } else {
    const row = Math.min(Math.max(at.row, 0), column.cells.length);
    column.cells.splice(row, 0, cell(paneId));
    next.cursor = { plane: plane.index, column: column.index, row };
  }
  next.maximizedPaneId = null;
  if (!next.homePaneId) next.homePaneId = paneId;
  return next;
}

export function closePane(layout: Layout, paneId: string): Layout {
  const focusedId = paneAt(layout, layout.cursor);
  const next = clone(layout);
  const located = locate(next, paneId);
  if (!located) return next;
  located.column.cells.splice(located.row, 1);
  if (located.column.cells.length === 0) {
    located.plane.columns = located.plane.columns.filter((column) => column !== located.column);
  }
  next.planes = next.planes.filter((plane) => plane.columns.length > 0);
  if (next.maximizedPaneId === paneId) next.maximizedPaneId = null;
  if (next.homePaneId === paneId) next.homePaneId = paneIds(next)[0] ?? null;
  next.groups = forgetPane(next.groups, paneId);
  if (focusedId && focusedId !== paneId) {
    const cursor = findCursor(next, focusedId);
    if (cursor) next.cursor = cursor;
  } else {
    next.cursor = neighborCursor(next, layout.cursor);
  }
  return next;
}

export function focusBy(layout: Layout, dx: number, dy: number, runway: number): Layout {
  const next = clone(layout);
  const moved = stepCursor(next, next.cursor, dx, dy, runway);
  if (!moved) return layout;
  next.cursor = moved;
  if (next.maximizedPaneId) {
    const id = paneAt(next, moved);
    next.maximizedPaneId = id;
  }
  return next;
}

export function focusPane(layout: Layout, paneId: string): Layout {
  const cursor = findCursor(layout, paneId);
  if (!cursor) return layout;
  const next = clone(layout);
  next.cursor = cursor;
  if (next.maximizedPaneId) next.maximizedPaneId = paneId;
  return next;
}

export function focusHome(layout: Layout): Layout {
  if (!layout.homePaneId) return layout;
  const next = focusPane(layout, layout.homePaneId);
  next.maximizedPaneId = null;
  return next;
}

export function focusEdge(layout: Layout, edge: "first" | "last"): Layout {
  const plane = planeAt(layout, layout.cursor.plane) ?? firstPlane(layout);
  if (!plane || plane.columns.length === 0) return layout;
  const columns = sortedColumns(plane);
  const column = edge === "first" ? columns[0] : columns[columns.length - 1];
  if (!column) return layout;
  const next = clone(layout);
  next.cursor = {
    plane: plane.index,
    column: column.index,
    row: Math.min(layout.cursor.row, column.cells.length - 1),
  };
  return next;
}

/** Drop a pane on another cell. Occupied cells swap; an empty slot becomes that pane's column. */
export function relocatePane(layout: Layout, paneId: string, target: Cursor): Layout {
  const next = clone(layout);
  const source = locate(next, paneId);
  if (!source) return layout;
  const width = source.column.widthPx;
  const plane = ensurePlane(next, target.plane);
  const column = columnAt(plane, target.column);
  if (!column) {
    source.column.cells.splice(source.row, 1);
    if (source.column.cells.length === 0) {
      source.plane.columns = source.plane.columns.filter((item) => item !== source.column);
    }
    plane.columns.push({ index: target.column, widthPx: width, cells: [source.cell] });
  } else if (column === source.column && target.row >= column.cells.length) {
    source.column.cells.splice(source.row, 1);
    column.cells.push(source.cell);
  } else {
    const row = Math.min(Math.max(target.row, 0), column.cells.length - 1);
    const destination = column.cells[row];
    if (!destination || destination === source.cell) return layout;
    swapCells(source.cell, destination);
  }
  next.planes = next.planes.filter((item) => item.columns.length > 0);
  const cursor = findCursor(next, paneId);
  if (cursor) next.cursor = cursor;
  return next;
}

/** Move the focused pane one structural step. Occupied cells swap. A free index adopts the column. */
export function movePane(layout: Layout, dx: number, dy: number, columnWidth: number): Layout {
  const id = paneAt(layout, layout.cursor);
  if (!id) return layout;
  const next = clone(layout);
  const source = locate(next, id);
  if (!source) return layout;

  if (dx !== 0 && dy === 0) {
    const targetIndex = source.column.index + dx;
    const targetColumn = columnAt(source.plane, targetIndex);
    if (!targetColumn) {
      if (source.column.cells.length === 1) source.column.index = targetIndex;
      else moveCellToNewColumn(source, targetIndex, columnWidth);
    } else {
      const row = Math.min(source.row, targetColumn.cells.length - 1);
      swapCells(source.cell, targetColumn.cells[row]!);
    }
  } else if (dy !== 0 && dx === 0) {
    const row = source.row + dy;
    const neighbor = source.column.cells[row];
    if (neighbor) {
      swapCells(source.cell, neighbor);
    } else {
      moveCellToPlane(next, source, source.plane.index + dy, columnWidth);
    }
  }

  const cursor = findCursor(next, id);
  if (cursor) next.cursor = cursor;
  return next;
}

export function moveColumn(layout: Layout, dx: number, dy: number): Layout {
  const next = clone(layout);
  const plane = planeAt(next, next.cursor.plane);
  const column = plane ? columnAt(plane, next.cursor.column) : undefined;
  if (!plane || !column) return layout;
  if (dx !== 0) {
    const ordered = sortedColumns(plane);
    const position = ordered.findIndex((item) => item.index === column.index);
    const neighbor = ordered[position + dx];
    if (!neighbor) return layout;
    const index = column.index;
    column.index = neighbor.index;
    neighbor.index = index;
    next.cursor = { ...next.cursor, column: column.index };
  } else if (dy !== 0) {
    const destination = ensurePlane(next, plane.index + dy);
    const occupant = columnAt(destination, column.index);
    plane.columns = plane.columns.filter((item) => item !== column);
    if (occupant) {
      destination.columns = destination.columns.filter((item) => item !== occupant);
      plane.columns.push(occupant);
    }
    destination.columns.push(column);
    next.planes = next.planes.filter((item) => item.columns.length > 0);
    next.cursor = { ...next.cursor, plane: destination.index };
  }
  return next;
}

export function splitBlank(layout: Layout, direction: "right" | "down" | "up", columnWidth: number): Layout {
  const next = clone(layout);
  const plane = ensurePlane(next, next.cursor.plane);
  const column = columnAt(plane, next.cursor.column);
  if (direction === "right" || !column) {
    const index = next.cursor.column + (direction === "right" ? 1 : 0);
    shiftColumns(plane, index, 1);
    plane.columns.push({
      index,
      widthPx: clampWidth(column?.widthPx ?? columnWidth),
      cells: [blank()],
    });
    next.cursor = { plane: plane.index, column: index, row: 0 };
    return next;
  }
  const row = direction === "up" ? next.cursor.row : next.cursor.row + 1;
  column.cells.splice(row, 0, blank());
  next.cursor = { ...next.cursor, row };
  return next;
}

/** Remove the focused blank cell. An empty column, including a hole between columns, closes up. */
export function dismissBlank(layout: Layout): Layout {
  const plane = planeAt(layout, layout.cursor.plane);
  const column = plane ? columnAt(plane, layout.cursor.column) : undefined;
  const cellItem = column?.cells[layout.cursor.row];
  if (cellItem?.paneId) return layout;
  const next = clone(layout);
  const nextPlane = planeAt(next, layout.cursor.plane);
  const nextColumn = nextPlane ? columnAt(nextPlane, layout.cursor.column) : undefined;
  if (nextColumn && !nextColumn.cells[layout.cursor.row]?.paneId) {
    const removedIndex = nextColumn.index;
    nextColumn.cells.splice(layout.cursor.row, 1);
    if (nextColumn.cells.length === 0 && nextPlane) {
      nextPlane.columns = nextPlane.columns.filter((item) => item !== nextColumn);
      shiftColumns(nextPlane, removedIndex + 1, -1);
    }
    next.planes = next.planes.filter((item) => item.columns.length > 0);
    next.cursor = neighborCursor(next, layout.cursor);
    return next;
  }
  if (nextPlane && closeColumnHole(nextPlane, layout.cursor.column)) {
    next.cursor = neighborCursor(next, layout.cursor);
    return next;
  }
  const cursor = neighborCursor(next, next.cursor);
  if (
    cursor.plane === layout.cursor.plane &&
    cursor.column === layout.cursor.column &&
    cursor.row === layout.cursor.row
  ) {
    return layout;
  }
  next.cursor = cursor;
  return next;
}

export function removeBlank(layout: Layout, direction: "up" | "down"): Layout {
  const next = clone(layout);
  const column = columnAt(planeAt(next, next.cursor.plane), next.cursor.column);
  if (!column) return layout;
  const row = next.cursor.row + (direction === "up" ? -1 : 1);
  const cellItem = column.cells[row];
  if (!cellItem?.reserved || cellItem.paneId) return layout;
  column.cells.splice(row, 1);
  if (direction === "up") next.cursor = { ...next.cursor, row: next.cursor.row - 1 };
  return next;
}

/** Pull the focused pane into the neighboring column as an extra stacked cell. */
export function insertAsSplit(layout: Layout, dx: -1 | 1, columnWidth: number): Layout {
  const id = paneAt(layout, layout.cursor);
  if (!id) return layout;
  const next = clone(layout);
  const source = locate(next, id);
  if (!source) return layout;
  const targetIndex = source.column.index + dx;
  let target = columnAt(source.plane, targetIndex);
  if (!target) {
    target = {
      index: targetIndex,
      widthPx: clampWidth(columnWidth),
      cells: [],
    };
    source.plane.columns.push(target);
  }
  source.column.cells.splice(source.row, 1);
  target.cells.push(source.cell);
  if (source.column.cells.length === 0) {
    source.plane.columns = source.plane.columns.filter((column) => column !== source.column);
  }
  const cursor = findCursor(next, id);
  if (cursor) next.cursor = cursor;
  return next;
}

export function splitPlane(layout: Layout, dy: -1 | 1, columnWidth: number): Layout {
  const next = clone(layout);
  const index = next.cursor.plane + dy;
  shiftPlanes(next, index, dy > 0 ? 1 : -1);
  const plane = ensurePlane(next, index);
  if (plane.columns.length === 0) {
    plane.columns.push({
      index: next.cursor.column,
      widthPx: clampWidth(columnWidth),
      cells: [blank()],
    });
  }
  next.cursor = { plane: index, column: next.cursor.column, row: 0 };
  return next;
}

export function resizeColumn(layout: Layout, cursor: Cursor, widthPx: number): Layout {
  const next = clone(layout);
  const column = columnAt(planeAt(next, cursor.plane), cursor.column);
  if (!column) return layout;
  column.widthPx = clampWidth(widthPx);
  return next;
}

export function resizeSplit(layout: Layout, cursor: Cursor, deltaWeight: number): Layout {
  const next = clone(layout);
  const column = columnAt(planeAt(next, cursor.plane), cursor.column);
  const above = column?.cells[cursor.row];
  const below = column?.cells[cursor.row + 1];
  if (!above || !below) return layout;
  const sum = above.weight + below.weight;
  const weight = clamp(above.weight + deltaWeight, MIN_WEIGHT, sum - MIN_WEIGHT);
  above.weight = weight;
  below.weight = sum - weight;
  return next;
}

export function toggleMaximized(layout: Layout): Layout {
  const next = clone(layout);
  const id = paneAt(next, next.cursor);
  next.maximizedPaneId = id && next.maximizedPaneId !== id ? id : null;
  return next;
}

export function measure(layout: Layout, viewport: Viewport, options: MeasureOptions): Scene {
  const planes = sortedPlanes(layout);
  const planeIndexes = rangeIncluding(
    planes.map((plane) => plane.index),
    layout.cursor.plane,
  );
  const columnHeight = Math.max(160, viewport.height - options.padding * 2);
  const boxes: Box[] = [];
  let maxX = options.padding;
  let y = options.padding;

  for (let position = 0; position < planeIndexes.length; position += 1) {
    const planeIndex = planeIndexes[position]!;
    const plane = planes.find((item) => item.index === planeIndex);
    const columns = plane ? sortedColumns(plane) : [];
    const columnIndexes = rangeIncluding(
      columns.map((column) => column.index),
      planeIndex === layout.cursor.plane ? layout.cursor.column : undefined,
    );
    let x = options.padding;
    for (const columnIndex of columnIndexes) {
      const column = columns.find((item) => item.index === columnIndex);
      const width = column?.widthPx ?? options.emptyWidth;
      const cells = column ? [...column.cells] : [blank()];
      if (
        column &&
        planeIndex === layout.cursor.plane &&
        columnIndex === layout.cursor.column &&
        layout.cursor.row >= cells.length
      ) {
        cells.push(blank());
      }
      const gapTotal = options.gap * Math.max(0, cells.length - 1);
      const available = Math.max(80, columnHeight - gapTotal);
      const weight = cells.reduce((sum, item) => sum + item.weight, 0) || 1;
      let cellY = y;
      cells.forEach((item, row) => {
        const height = (available * item.weight) / weight;
        boxes.push({
          paneId: item.paneId,
          plane: planeIndex,
          column: columnIndex,
          row,
          x,
          y: cellY,
          width,
          height,
          reserved: item.reserved,
        });
        cellY += height + options.gap;
      });
      x += width + options.gap;
      maxX = Math.max(maxX, x);
    }
    y += columnHeight + options.gap * 4;
  }

  return {
    boxes,
    width: Math.max(maxX, viewport.width),
    height: Math.max(y, viewport.height),
  };
}

export function cursorBox(scene: Scene, cursor: Cursor): Box | undefined {
  return scene.boxes.find(
    (box) => box.plane === cursor.plane && box.column === cursor.column && box.row === cursor.row,
  );
}

export function cameraFor(
  box: Pick<Box, "x" | "y" | "width" | "height">,
  viewport: Viewport,
  anchor: "center" | "start",
  scale = 1,
): { x: number; y: number } {
  if (anchor === "start") {
    return { x: box.x - 20 / scale, y: box.y - 20 / scale };
  }
  return {
    x: box.x + box.width / 2 - viewport.width / (2 * scale),
    y: box.y + box.height / 2 - viewport.height / (2 * scale),
  };
}

export function sceneBounds(scene: Scene, padding: number): Pick<Box, "x" | "y" | "width" | "height"> {
  if (scene.boxes.length === 0) {
    return { x: 0, y: 0, width: padding * 2, height: padding * 2 };
  }
  const minX = Math.min(...scene.boxes.map((box) => box.x)) - padding;
  const minY = Math.min(...scene.boxes.map((box) => box.y)) - padding;
  const maxX = Math.max(...scene.boxes.map((box) => box.x + box.width)) + padding;
  const maxY = Math.max(...scene.boxes.map((box) => box.y + box.height)) + padding;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function stepCursor(layout: Layout, cursor: Cursor, dx: number, dy: number, runway: number): Cursor | null {
  if (dx === 0 && dy === 0) return null;
  let next: Cursor = { ...cursor, column: cursor.column + dx };
  if (dy !== 0) {
    const column = columnAt(planeAt(layout, cursor.plane), cursor.column);
    const rows = column?.cells.length ?? 0;
    const row = cursor.row + dy;
    if (column && row >= 0 && row < rows) {
      next = { ...cursor, row };
    } else if (column && row === rows && !planeAt(layout, cursor.plane + dy)) {
      next = { ...cursor, row };
    } else {
      const plane = cursor.plane + Math.sign(dy);
      const destination = columnAt(planeAt(layout, plane), cursor.column);
      const destRows = destination?.cells.length ?? 0;
      next = {
        plane,
        column: cursor.column,
        row: dy > 0 ? 0 : Math.max(0, destRows - 1),
      };
    }
  } else {
    const destination = columnAt(planeAt(layout, next.plane), next.column);
    next.row = destination ? Math.min(cursor.row, Math.max(0, destination.cells.length - 1)) : 0;
  }
  return withinRunway(layout, next, runway) ? next : null;
}

function withinRunway(layout: Layout, cursor: Cursor, runway: number): boolean {
  const extents = extentsOf(layout);
  if (extents.empty) {
    return cursor.plane === 0 && cursor.column === 0 && cursor.row === 0;
  }
  return (
    cursor.plane >= extents.minPlane - runway &&
    cursor.plane <= extents.maxPlane + runway &&
    cursor.column >= extents.minCol - runway &&
    cursor.column <= extents.maxCol + runway &&
    cursor.row >= 0 &&
    cursor.row <= extents.maxRow + runway + 1
  );
}

function extentsOf(layout: Layout) {
  let minPlane = Infinity;
  let maxPlane = -Infinity;
  let minCol = Infinity;
  let maxCol = -Infinity;
  let maxRow = 0;
  for (const plane of layout.planes) {
    minPlane = Math.min(minPlane, plane.index);
    maxPlane = Math.max(maxPlane, plane.index);
    for (const column of plane.columns) {
      minCol = Math.min(minCol, column.index);
      maxCol = Math.max(maxCol, column.index);
      maxRow = Math.max(maxRow, column.cells.length - 1);
    }
  }
  return {
    empty: !Number.isFinite(minPlane),
    minPlane,
    maxPlane,
    minCol,
    maxCol,
    maxRow,
  };
}

function moveCellToNewColumn(
  source: { plane: Plane; column: Column; cell: Cell; row: number },
  index: number,
  columnWidth: number,
): void {
  source.column.cells.splice(source.row, 1);
  source.plane.columns.push({
    index,
    widthPx: clampWidth(columnWidth),
    cells: [source.cell],
  });
}

function moveCellToPlane(
  layout: Layout,
  source: { plane: Plane; column: Column; cell: Cell; row: number },
  planeIndex: number,
  columnWidth: number,
): void {
  const destination = ensurePlane(layout, planeIndex);
  source.column.cells.splice(source.row, 1);
  if (source.column.cells.length === 0) {
    source.plane.columns = source.plane.columns.filter((column) => column !== source.column);
  }
  layout.planes = layout.planes.filter((plane) => plane.columns.length > 0 || plane === destination);
  const column = columnAt(destination, source.column.index);
  if (!column) {
    destination.columns.push({
      index: source.column.index,
      widthPx: source.column.widthPx || clampWidth(columnWidth),
      cells: [source.cell],
    });
    return;
  }
  column.cells.push(source.cell);
}

function swapCells(left: Cell, right: Cell): void {
  if (left === right) return;
  const paneId = left.paneId;
  const reserved = left.reserved;
  left.paneId = right.paneId;
  left.reserved = right.reserved;
  right.paneId = paneId;
  right.reserved = reserved;
}

function neighborCursor(layout: Layout, previous: Cursor): Cursor {
  const same = cellAt(layout, previous);
  if (same?.paneId) return { ...previous };
  const column = columnAt(planeAt(layout, previous.plane), previous.column);
  if (column && column.cells.length > 0) {
    return {
      plane: previous.plane,
      column: previous.column,
      row: Math.min(previous.row, column.cells.length - 1),
    };
  }
  const id = paneIds(layout)[0];
  return id ? findCursor(layout, id)! : { plane: 0, column: 0, row: 0 };
}

function paneAt(layout: Layout, cursor: Cursor): string | null {
  return cellAt(layout, cursor)?.paneId ?? null;
}

function cellAt(layout: Layout, cursor: Cursor): Cell | undefined {
  return columnAt(planeAt(layout, cursor.plane), cursor.column)?.cells[cursor.row];
}

function locate(layout: Layout, paneId: string) {
  for (const plane of layout.planes) {
    for (const column of plane.columns) {
      const row = column.cells.findIndex((item) => item.paneId === paneId);
      if (row >= 0) {
        const cellItem = column.cells[row];
        if (!cellItem) return null;
        return { plane, column, cell: cellItem, row };
      }
    }
  }
  return null;
}

function planeAt(layout: Layout, index: number): Plane | undefined {
  return layout.planes.find((plane) => plane.index === index);
}

function firstPlane(layout: Layout): Plane | undefined {
  return sortedPlanes(layout)[0];
}

function ensurePlane(layout: Layout, index: number): Plane {
  const existing = planeAt(layout, index);
  if (existing) return existing;
  const plane: Plane = { index, columns: [] };
  layout.planes.push(plane);
  return plane;
}

function columnAt(plane: Plane | undefined, index: number): Column | undefined {
  return plane?.columns.find((column) => column.index === index);
}

/** Pull later columns into a missing index so the strip no longer draws an empty slot there. */
function closeColumnHole(plane: Plane, index: number): boolean {
  const indexes = plane.columns.map((column) => column.index);
  if (indexes.length === 0 || indexes.includes(index)) return false;
  const nextReal = indexes.filter((item) => item > index).sort((left, right) => left - right)[0];
  if (nextReal === undefined || !indexes.some((item) => item < index)) return false;
  shiftColumns(plane, nextReal, index - nextReal);
  return true;
}

function shiftColumns(plane: Plane, at: number, delta: number): void {
  for (const column of plane.columns) {
    if (column.index >= at) column.index += delta;
  }
}

function shiftPlanes(layout: Layout, at: number, delta: number): void {
  if (delta === 0) return;
  for (const plane of layout.planes) {
    if (delta > 0 ? plane.index >= at : plane.index <= at) plane.index += delta;
  }
}

function sortedPlanes(layout: Layout): Plane[] {
  return [...layout.planes].sort((left, right) => left.index - right.index);
}

function sortedColumns(plane: Plane): Column[] {
  return [...plane.columns].sort((left, right) => left.index - right.index);
}

function rangeIncluding(indexes: number[], extra: number | undefined): number[] {
  const values = extra === undefined ? indexes : [...indexes, extra];
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range: number[] = [];
  for (let index = min; index <= max; index += 1) range.push(index);
  return range;
}

function cell(paneId: string): Cell {
  return { paneId, reserved: false, weight: 1 };
}

function blank(): Cell {
  return { paneId: null, reserved: true, weight: 1 };
}

function clampWidth(width: number): number {
  if (!Number.isFinite(width)) return 560;
  return Math.round(clamp(width, MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function assertCursor(cursor: unknown): asserts cursor is Cursor {
  if (!cursor || typeof cursor !== "object") throw new Error("Layout cursor is invalid.");
  const point = cursor as Partial<Cursor>;
  for (const key of ["plane", "column", "row"] as const) {
    if (typeof point[key] !== "number" || !Number.isInteger(point[key])) {
      throw new Error("Layout cursor must use integer coordinates.");
    }
  }
}

function clone(layout: Layout): Layout {
  return structuredClone(layout);
}
