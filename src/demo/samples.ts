import { shortcutLabel, type ShortcutAction } from "../workspace/shortcuts.ts";
import type { PaneDefinition } from "../types.ts";
import type { SeedColumn } from "../layout/layout.ts";
import type { PaneGroup } from "../layout/groups.ts";

const apple =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

export const sampleColumns: SeedColumn[] = [
  { paneIds: ["guide"], widthPx: 640 },
  { paneIds: ["clock"] },
  { paneIds: ["ledger"] },
  { paneIds: ["palette", "notes"] },
];

export const sampleGroups: PaneGroup[] = [
  { id: "reference", name: "Reference", color: "#7aa2d6", paneIds: ["palette", "notes"] },
];

export function samplePanes(): PaneDefinition[] {
  return [
    {
      paneId: "guide",
      title: "Guide",
      surfaceKind: "html",
      source: { kind: "html", html: guideHtml() },
    },
    pane("clock", "Clock", "element", "panes/clock.ts", "element"),
    pane("ledger", "Ledger", "react", "panes/ledger.tsx", "react"),
    pane("palette", "Palette", "vue", "panes/palette.vue", "vue"),
    pane("notes", "Notes", "svelte", "panes/notes.svelte", "svelte"),
  ];
}

function keycaps(parts: readonly string[]): string {
  return `<span class="guide-keys">${parts.map((part) => `<kbd>${part}</kbd>`).join("")}</span>`;
}

function pane(
  paneId: string,
  title: string,
  surfaceKind: string,
  file: string,
  framework: "element" | "react" | "vue" | "svelte",
): PaneDefinition {
  const params = new URLSearchParams({ file, framework });
  return {
    paneId,
    title,
    surfaceKind,
    source: { kind: "module", url: `/_tape/compile?${params}` },
  };
}

function guideHtml(): string {
  const rows: [ShortcutAction, string][] = [
    ["moveLeft", "Swap the focused pane one cell left"],
    ["insertRight", "Stack the pane into the column beside it"],
    ["splitRight", "Open a blank column to the right"],
    ["splitDown", "Open a blank row below"],
    ["overview", "Zoom out to every pane"],
    ["maximize", "Fill the stage with the focused pane"],
    ["selectGroup", "Select the whole column, then move it with Ctrl"],
    ["home", "Return to the first pane"],
    ["editGroup", "Put this pane in a named group"],
    ["groupNext", "Move to the next pane in that group"],
    ["spotlight", "Search panes, commands, and workspaces"],
    ["closePane", "Close the focused pane, or remove the blank cell you are on"],
    ["reopenPane", "Reopen the pane you just closed"],
    ["historyBack", "Return to the pane you came from"],
  ];
  const items = [
    `<dt>${keycaps([apple ? "⌥" : "Alt", "←", "↑", "↓", "→"])}</dt><dd>Move to the neighboring cell, including an empty one. ${keycaps(["H", "J", "K", "L"])} work too.</dd>`,
    ...rows.map(([action, description]) => `<dt>${keycaps(shortcutLabel(action, apple).split("+"))}</dt><dd>${description}</dd>`),
  ].join("");
  return `<article class="guide">
    <p class="guide-kicker">niri-js</p>
    <h2>Panes keep their size. The stage scrolls to them.</h2>
    <p>Each column is a strip of the workspace. Splitting or opening a pane adds a cell beside the others instead of squeezing them. Alt is the modifier, Option on a Mac. Drag a title to rearrange, or drag the right and bottom edges to resize.</p>
    <p>The panes beside this one are a custom element, a React ledger, a Vue palette, and a Svelte list. New pane can load any of those, plus a module URL that exports <code>mount(host, context)</code>.</p>
    <dl>${items}</dl>
  </article>`;
}
