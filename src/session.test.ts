import { expect, test } from "bun:test";
import { createLayout } from "./layout.ts";
import { exportDocument, normalizeSession, parseLayoutFile, pushClosed, workspaceIdFor } from "./session.ts";
import type { PaneDefinition } from "./types.ts";

function pane(id: string): PaneDefinition {
  return { paneId: id, title: id, surfaceKind: "html", source: { kind: "html", html: `<p>${id}</p>` } };
}

test("a single-strip save becomes the Main workspace", () => {
  const layout = createLayout("tape", [{ paneIds: ["guide"] }], 500);
  const session = normalizeSession({ schema: 1, layout, panes: [pane("guide"), { paneId: "nope" }] });
  expect(session?.activeId).toBe("main");
  expect(session?.workspaces.map((item) => item.name)).toEqual(["Main"]);
  expect(session?.workspaces[0]?.panes.map((item) => item.paneId)).toEqual(["guide"]);
  expect(session?.closed).toEqual([]);
});

test("export and import keep the active strip", () => {
  const layout = createLayout("tape", [{ paneIds: ["guide"] }, { paneIds: ["clock"] }], 500);
  const raw = exportDocument({
    id: "writing",
    name: "Writing",
    layout,
    panes: [
      pane("guide"),
      pane("clock"),
      { paneId: "live", title: "Live", surfaceKind: "mount", source: { kind: "mount", mount() {} } },
    ],
  });
  const parsed = parseLayoutFile(raw);
  expect(parsed?.panes.map((item) => item.paneId)).toEqual(["guide", "clock"]);
  expect(parsed?.layout.planes[0]?.columns).toHaveLength(2);
});

test("the closed stack keeps the newest copy of a pane and stops at twelve", () => {
  const cursor = { plane: 0, column: 1, row: 0 };
  let closed = pushClosed([], { pane: pane("a"), cursor, groupId: null });
  closed = pushClosed(closed, { pane: pane("a"), cursor: { ...cursor, column: 3 }, groupId: "g" });
  for (let index = 0; index < 14; index += 1) {
    closed = pushClosed(closed, { pane: pane(`p${index}`), cursor, groupId: null });
  }
  expect(closed).toHaveLength(12);
  expect(closed.some((item) => item.pane.paneId === "a")).toBe(false);
  expect(closed[0]?.pane.paneId).toBe("p13");
});

test("workspace ids stay unique", () => {
  expect(workspaceIdFor("Writing desk", new Set(["writing-desk"]))).toBe("writing-desk-2");
});
