import { expect, test } from "bun:test";
import { compilePane, compilePaneRequest, frameworkFor } from "./compile.ts";

test("framework follows the file and an explicit override", () => {
  expect(frameworkFor("panes/palette.vue", null)).toBe("vue");
  expect(frameworkFor("panes/notes.svelte", null)).toBe("svelte");
  expect(frameworkFor("panes/ledger.tsx", null)).toBe("react");
  expect(frameworkFor("panes/clock.ts", "element")).toBe("element");
});

test("refuses files outside the project", async () => {
  await expect(compilePane("../secrets.ts", "element")).rejects.toThrow(/outside/);
  await expect(compilePane("panes/notes.txt", "element")).rejects.toThrow(/Cannot load/);
  await expect(compilePane("panes/missing.tsx", "react")).rejects.toThrow(/No pane/);
});

test("the compile route returns javascript or a 400", async () => {
  const missing = await compilePaneRequest(new Request("http://localhost:3000/_tape/compile"));
  expect(missing.status).toBe(400);
  const clock = await compilePaneRequest(
    new Request("http://localhost:3000/_tape/compile?file=panes/clock.ts&framework=element"),
  );
  expect(clock.status).toBe(200);
  expect(clock.headers.get("content-type")).toContain("javascript");
  expect(await clock.text()).toContain("customElements");
  const absent = await compilePaneRequest(new Request("http://localhost:3000/_tape/compile?file=panes/nope.tsx"));
  expect(absent.status).toBe(400);
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
