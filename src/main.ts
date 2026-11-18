import { TapeWorkspace } from "./workspace.ts";
import { sampleColumns, sampleGroups, samplePanes } from "./samples.ts";

const root = document.querySelector("#app");
if (!(root instanceof HTMLElement)) {
  throw new Error("Missing #app.");
}

new TapeWorkspace(root, {
  workspaceId: "tape",
  storageKey: "niri-js",
  panes: samplePanes(),
  columns: sampleColumns,
  groups: sampleGroups,
  liveContent: true,
  runway: 1,
  focusAnchor: "center",
});
