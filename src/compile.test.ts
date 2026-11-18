import { expect, test } from "bun:test";
import { compilePane, frameworkFor } from "./compile.ts";

test("framework follows the file and an explicit override", () => {
  expect(frameworkFor("panes/palette.vue", null)).toBe("vue");
  expect(frameworkFor("panes/notes.svelte", null)).toBe("svelte");
  expect(frameworkFor("panes/ledger.tsx", null)).toBe("react");
  expect(frameworkFor("panes/clock.ts", "element")).toBe("element");
});

test("refuses files outside the project", async () => {
  await expect(compilePane("../secrets.ts", "element")).rejects.toThrow(/outside/);
});

test("wraps react, vue, svelte, and a custom element", async () => {
  const react = await compilePane("panes/ledger.tsx", "react");
  const vue = await compilePane("panes/palette.vue", "vue");
  const svelte = await compilePane("panes/notes.svelte", "svelte");
  const element = await compilePane("panes/clock.ts", "element");
  expect(react).toContain("createRoot");
  expect(vue).toContain("createApp");
  expect(svelte).toContain("createClassComponent");
  expect(element).toContain("customElements");
}, 30_000);
