import { expect, test } from "bun:test";
import { sampleColumns, samplePanes } from "./samples.ts";

test("the sample strip includes html, a custom element, react, vue, and svelte", () => {
  const panes = samplePanes();
  expect(panes.map((pane) => pane.surfaceKind)).toEqual(["html", "element", "react", "vue", "svelte"]);
  expect(panes.find((pane) => pane.paneId === "ledger")?.source).toEqual({
    kind: "module",
    url: "/_tape/compile?file=panes%2Fledger.tsx&framework=react",
  });
  expect(sampleColumns.map((column) => column.paneIds)).toEqual([
    ["guide"],
    ["clock"],
    ["ledger"],
    ["palette", "notes"],
  ]);
  const guide = panes[0];
  if (guide?.source.kind !== "html") throw new Error("guide is html");
  expect(guide.source.html).toContain("mount(host, context)");
});
