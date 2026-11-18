import { describe, expect, test } from "bun:test";
import {
  assertLayout,
  cameraFor,
  closePane,
  createLayout,
  cursorBox,
  focusBy,
  focusEdge,
  insertAsSplit,
  measure,
  moveColumn,
  movePane,
  openPane,
  paneIds,
  resizeColumn,
  splitBlank,
  splitPlane,
  toggleMaximized,
} from "./layout.ts";

const options = { gap: 20, padding: 10, emptyWidth: 400 };

function tape() {
  return createLayout(
    "tape",
    [{ paneIds: ["a"] }, { paneIds: ["b", "c"] }, { paneIds: ["d"] }],
    500,
  );
}

describe("layout", () => {
  test("opens a column to the right without resizing the others", () => {
    const opened = openPane(tape(), "e", 640);
    const plane = opened.planes[0]!;
    const widths = [...plane.columns]
      .sort((left, right) => left.index - right.index)
      .map((column) => column.widthPx);
    expect(widths).toEqual([500, 640, 500, 500]);
    expect(opened.cursor).toEqual({ plane: 0, column: 1, row: 0 });
    expect(paneIds(opened)).toContain("e");
  });

  test("fills a reserved blank instead of inserting another column", () => {
    const blanked = splitBlank(tape(), "right", 500);
    const filled = openPane(blanked, "e", 500);
    expect(filled.planes[0]!.columns).toHaveLength(4);
    expect(paneIds(filled)).toContain("e");
    const cell = filled.planes[0]!.columns.find((column) => column.index === filled.cursor.column)
      ?.cells[0];
    expect(cell).toEqual({ paneId: "e", reserved: false, weight: 1 });
  });

  test("closing an interior column leaves a sparse hole and does not renumber", () => {
    const closed = closePane(tape(), "b");
    const indexes = closed.planes[0]!.columns.map((column) => column.index).sort((a, b) => a - b);
    expect(indexes).toEqual([0, 1, 2]);
    const scene = measure(closed, { width: 1200, height: 800 }, options);
    const empty = scene.boxes.find((box) => box.paneId === null && box.column === 1 && box.row === 0);
    expect(empty).toBeUndefined();
    expect(scene.boxes.some((box) => box.paneId === "c" && box.column === 1)).toBe(true);
  });

  test("closing the only pane in a middle column keeps the neighboring indexes", () => {
    const closed = closePane(closePane(tape(), "b"), "c");
    const indexes = closed.planes[0]!.columns.map((column) => column.index).sort((a, b) => a - b);
    expect(indexes).toEqual([0, 2]);
    const scene = measure(closed, { width: 1400, height: 800 }, options);
    const hole = scene.boxes.find((box) => box.column === 1 && box.paneId === null);
    expect(hole?.width).toBe(400);
    const right = scene.boxes.find((box) => box.paneId === "d");
    const left = scene.boxes.find((box) => box.paneId === "a");
    expect(right && left && right.x > left.x + left.width).toBe(true);
  });

  test("focus steps into the empty cell instead of skipping to the next pane", () => {
    const layout = closePane(closePane(tape(), "b"), "c");
    const focused = focusBy(layout, 1, 0, 1);
    expect(focused.cursor).toEqual({ plane: 0, column: 1, row: 0 });
    const scene = measure(focused, { width: 1400, height: 800 }, options);
    expect(cursorBox(scene, focused.cursor)?.paneId).toBeNull();
  });

  test("focus refuses to walk past the runway", () => {
    const layout = tape();
    const once = focusBy(layout, -1, 0, 1);
    expect(once.cursor.column).toBe(-1);
    expect(focusBy(once, -1, 0, 1)).toBe(once);
  });

  test("vertical focus stays in a stack and then reaches the next plane", () => {
    const layout = focusBy(tape(), 1, 0, 1);
    expect(focusBy(layout, 0, 1, 1).cursor).toEqual({ plane: 0, column: 1, row: 1 });
    const below = splitPlane(tape(), 1, 500);
    const moved = focusBy({ ...below, cursor: { plane: 0, column: 1, row: 1 } }, 0, 1, 1);
    expect(moved.cursor.plane).toBe(1);
    expect(moved.cursor.row).toBe(0);
  });

  test("moving sideways swaps panes and keeps both column widths", () => {
    const moved = movePane(tape(), 1, 0, 500);
    expect(moved.cursor).toEqual({ plane: 0, column: 1, row: 0 });
    const column = moved.planes[0]!.columns.find((item) => item.index === 1)!;
    expect(column.cells[0]!.paneId).toBe("a");
    expect(moved.planes[0]!.columns.find((item) => item.index === 0)!.cells[0]!.paneId).toBe("b");
    expect(column.widthPx).toBe(500);
  });

  test("moving a lone pane left adopts the free index and leaves the old slot empty", () => {
    const moved = movePane(tape(), -1, 0, 500);
    const indexes = moved.planes[0]!.columns.map((column) => column.index).sort((a, b) => a - b);
    expect(indexes).toEqual([-1, 1, 2]);
    expect(moved.planes[0]!.columns.find((column) => column.index === -1)!.cells[0]!.paneId).toBe("a");
  });

  test("inserting as a split stacks into the neighbor and removes the empty source", () => {
    const stacked = insertAsSplit(tape(), 1, 500);
    const source = stacked.planes[0]!.columns.find((column) => column.index === 0);
    const target = stacked.planes[0]!.columns.find((column) => column.index === 1)!;
    expect(source).toBeUndefined();
    expect(target.cells.map((cell) => cell.paneId)).toEqual(["b", "c", "a"]);
  });

  test("column group move swaps indexes and follows the group", () => {
    const moved = moveColumn(tape(), 1, 0);
    expect(moved.cursor.column).toBe(1);
    expect(moved.planes[0]!.columns.find((column) => column.index === 1)!.cells[0]!.paneId).toBe("a");
    expect(moved.planes[0]!.columns.find((column) => column.index === 0)!.cells[0]!.paneId).toBe("b");
  });

  test("a new plane is inserted below without renumbering upward panes out of order", () => {
    const split = splitPlane(tape(), 1, 480);
    const indexes = split.planes.map((plane) => plane.index).sort((a, b) => a - b);
    expect(indexes).toEqual([0, 1]);
    expect(split.cursor.plane).toBe(1);
    expect(split.planes.find((plane) => plane.index === 1)!.columns[0]!.cells[0]!.paneId).toBeNull();
  });

  test("resize changes one column", () => {
    const resized = resizeColumn(tape(), tape().cursor, 900);
    expect(resized.planes[0]!.columns.find((column) => column.index === 0)!.widthPx).toBe(900);
    expect(resized.planes[0]!.columns.find((column) => column.index === 1)!.widthPx).toBe(500);
  });

  test("home and edge focus", () => {
    const layout = focusBy(focusBy(tape(), 1, 0, 1), 1, 0, 1);
    expect(focusEdge(layout, "first").cursor.column).toBe(0);
    expect(focusEdge(layout, "last").cursor.column).toBe(2);
  });

  test("maximize follows the focused pane id", () => {
    const maximized = toggleMaximized(tape());
    expect(maximized.maximizedPaneId).toBe("a");
    expect(toggleMaximized(maximized).maximizedPaneId).toBeNull();
  });

  test("round-trips through validation and centers the focused box", () => {
    const layout = tape();
    assertLayout(JSON.parse(JSON.stringify(layout)));
    const scene = measure(layout, { width: 1000, height: 800 }, options);
    const box = cursorBox(scene, layout.cursor)!;
    const camera = cameraFor(box, { width: 1000, height: 800 }, "center");
    expect(camera.x + 500).toBeCloseTo(box.x + box.width / 2);
    expect(camera.y + 400).toBeCloseTo(box.y + box.height / 2);
  });

  test("rejects a duplicate pane id", () => {
    const layout = tape();
    layout.planes[0]!.columns[2]!.cells[0]!.paneId = "a";
    expect(() => assertLayout(layout)).toThrow(/Duplicate/);
  });
});
