import { expect, test } from "bun:test";
import { closePane, createLayout, focusPane } from "./layout.ts";
import { assertLayout } from "./layout.ts";
import {
  addPaneToGroup,
  assignPane,
  cycleMember,
  forgetPane,
  groupOf,
  normalizeGroups,
  ungroupPane,
} from "./groups.ts";

function tape() {
  return createLayout("tape", [{ paneIds: ["a"] }, { paneIds: ["b"] }, { paneIds: ["c", "d"] }], 500);
}

test("a new name starts a group and the same name joins it", () => {
  const created = addPaneToGroup([], "Studio", "a");
  expect(created).toHaveLength(1);
  expect(created[0]?.paneIds).toEqual(["a"]);
  expect(created[0]?.color).toMatch(/^#/);
  const joined = addPaneToGroup(created, "studio", "b");
  expect(joined).toHaveLength(1);
  expect(joined[0]?.paneIds).toEqual(["a", "b"]);
  expect(groupOf(joined, "b")?.id).toBe(created[0]?.id);
});

test("assigning a pane removes it from the previous group", () => {
  const first = addPaneToGroup([], "Studio", "a");
  const second = addPaneToGroup(first, "Notes", "b");
  const moved = assignPane(second, "a", second[1]!.id);
  expect(moved.map((group) => group.name)).toEqual(["Notes"]);
  expect(moved[0]?.paneIds).toEqual(["b", "a"]);
});

test("ungrouping the last member drops the group", () => {
  const groups = addPaneToGroup([], "Studio", "a");
  expect(ungroupPane(groups, "a")).toEqual([]);
});

test("closing a pane forgets it and keeps the other members", () => {
  const layout = tape();
  layout.groups = addPaneToGroup(addPaneToGroup([], "Studio", "a"), "Studio", "c");
  const closed = closePane(layout, "a");
  expect(closed.groups.map((group) => group.paneIds)).toEqual([["c"]]);
  expect(forgetPane(closed.groups, "c")).toEqual([]);
});

test("cycling follows strip order and wraps", () => {
  const layout = focusPane(tape(), "b");
  layout.groups = addPaneToGroup(addPaneToGroup([], "Studio", "d"), "Studio", "a");
  expect(cycleMember(layout, "studio", "b", 1)).toBe("a");
  expect(cycleMember(layout, "studio", "a", 1)).toBe("d");
  expect(cycleMember(layout, "studio", "d", 1)).toBe("a");
  expect(cycleMember(layout, "studio", "a", -1)).toBe("d");
});

test("a layout saved before groups still loads", () => {
  const saved = JSON.parse(JSON.stringify(tape())) as { groups?: unknown };
  delete saved.groups;
  assertLayout(saved);
  expect(saved.groups).toEqual([]);
});

test("saved groups drop panes that are no longer on the strip", () => {
  const groups = normalizeGroups(
    [
      { id: "studio", name: "Studio", color: "#fff", paneIds: ["a", "missing", "a"] },
      { id: "studio", name: "Duplicate", paneIds: ["b"] },
      { name: "Nope", paneIds: ["c"] },
    ],
    new Set(["a", "b"]),
  );
  expect(groups).toEqual([{ id: "studio", name: "Studio", color: "#fff", paneIds: ["a"] }]);
});
