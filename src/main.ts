import { TapeWorkspace } from "./workspace.ts";
import { sampleColumns, samplePanes } from "./samples.ts";

const root = document.querySelector("#app");
if (!(root instanceof HTMLElement)) {
  throw new Error("Missing #app.");
}

new TapeWorkspace(root, {
  workspaceId: "tape",
  storageKey: "scrolling-tape-layout",
  panes: samplePanes(),
  columns: sampleColumns,
  liveContent: true,
  runway: 1,
  focusAnchor: "center",
});
