import { expect, test } from "bun:test";
import { searchPanes, searchPalette, type SpotlightEntry } from "./spotlight.ts";

const panes: SpotlightEntry[] = [
  { paneId: "guide", title: "Guide", surfaceKind: "html" },
  { paneId: "clock", title: "Clock", surfaceKind: "element" },
  { paneId: "ledger", title: "Ledger", surfaceKind: "react" },
  { paneId: "palette", title: "Palette", surfaceKind: "vue" },
  { paneId: "notes", title: "Notes", surfaceKind: "svelte" },
];

test("an empty query lists the focused pane first and then the strip", () => {
  const hits = searchPanes(panes, "  ", "ledger");
  expect(hits.map((hit) => hit.paneId)).toEqual(["ledger", "guide", "clock", "palette", "notes"]);
  expect(hits[0]?.titleMarks).toEqual([]);
});

test("a title prefix outranks a later substring and a kind match", () => {
  const hits = searchPanes(panes, "le");
  expect(hits[0]?.paneId).toBe("ledger");
  expect(hits[0]?.titleMarks).toEqual([0, 1]);
  expect(hits[1]?.paneId).toBe("palette");
  expect(hits[1]?.titleMarks).toEqual([2, 3]);
  const clock = hits.find((hit) => hit.paneId === "clock");
  expect(clock?.titleMarks).toEqual([]);
  expect(clock && hits[0] && clock.score < hits[0].score).toBe(true);
});

test("a word inside the title is marked", () => {
  const hits = searchPanes(
    [{ paneId: "studio", title: "Studio ledger", surfaceKind: "react" }],
    "led",
  );
  expect(hits[0]?.titleMarks).toEqual([7, 8, 9]);
  expect(hits[0]?.score).toBe(80);
});

test("a loose subsequence still finds the pane", () => {
  const hits = searchPanes(panes, "ldgr");
  expect(hits.map((hit) => hit.paneId)).toEqual(["ledger"]);
  expect(hits[0]?.titleMarks).toEqual([0, 2, 3, 5]);
});

test("nothing matches an unrelated query", () => {
  expect(searchPanes(panes, "zzzz")).toEqual([]);
});

test("an empty palette lists panes first, then closed panes, workspaces, and commands", () => {
  const hits = searchPalette(
    [
      { id: "guide", kind: "pane", title: "Guide", kindLabel: "html", where: "Column 1" },
      { id: "clock", kind: "pane", title: "Clock", kindLabel: "element", where: "Column 2" },
      { id: "notes", kind: "closed", title: "Notes", kindLabel: "closed", where: "Reopen" },
      { id: "main", kind: "workspace", title: "Main", kindLabel: "space", where: "Current" },
      { id: "overview", kind: "command", title: "Overview", kindLabel: "command", where: "⌥+O", keywords: "zoom" },
    ],
    "",
    "clock",
  );
  expect(hits.map((hit) => hit.id)).toEqual(["clock", "guide", "notes", "main", "overview"]);
});

test("a command matches its name and a loose pane query does not pull commands in", () => {
  const entries = [
    { id: "ledger", kind: "pane" as const, title: "Ledger", kindLabel: "react", where: "Column 3" },
    { id: "overview", kind: "command" as const, title: "Overview", kindLabel: "command", where: "", keywords: "zoom" },
    { id: "reopen-pane", kind: "command" as const, title: "Reopen closed pane", kindLabel: "command", where: "" },
  ];
  expect(searchPalette(entries, "over").map((hit) => hit.id)).toEqual(["overview"]);
  expect(searchPalette(entries, "led").map((hit) => hit.id)).toEqual(["ledger"]);
});
