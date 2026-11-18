# niri-js

A native scrolling workspace, in the spirit of [Onirigiri](https://github.com/riteofstring/onirigiri) and [niri](https://github.com/niri-wm/niri). Panes sit in columns on a horizontal strip. Opening one adds a column instead of shrinking the others. The camera scrolls to the focused pane, and overview zooms out to the whole strip.

The workspace is plain TypeScript. A pane can be HTML, a custom element, a React component, a Vue component, or a Svelte component.

## Install

```bash
bun add niri-js
```

```ts
import { TapeWorkspace } from "niri-js";
import "niri-js/styles.css";

const root = document.querySelector("#app");
if (!(root instanceof HTMLElement)) throw new Error("Missing #app.");

const workspace = new TapeWorkspace(root, {
  storageKey: "niri-js",
  panes: [
    {
      paneId: "notes",
      title: "Notes",
      surfaceKind: "html",
      source: { kind: "html", html: "<p>Hello</p>" },
    },
  ],
});
```

Give the container a height. `.tape` fills it. Create the workspace in the browser, after the container is on the page, and call `workspace.destroy()` when the page goes away.

React, Vue, and Svelte are optional. Install the one a pane mounts:

```ts
workspace.openPane({
  paneId: "chart",
  title: "Chart",
  surfaceKind: "react",
  source: { kind: "react", component: Chart },
});
```

These sources work too:

- `{ kind: "html", html }`
- `{ kind: "element", tag: "my-widget" }`
- `{ kind: "vue" | "svelte", component }`
- `{ kind: "mount", mount }`
- `{ kind: "module", url }` when that URL's module exports `mount(host, context)`

## Run the demo

```bash
bun install
bun dev
```

Then open the URL Bun prints. `bun test` checks the layout engine and that each kind of pane compiles. `bun run build` writes the package to `dist/`.

This demo compiles a project file, such as `panes/ledger.tsx`, through `GET /_tape/compile`. That route belongs to the demo server. The published package mounts a component or a module URL.

## Shortcuts

Alt (Option on a Mac) is the modifier.

| Keys | Action |
| --- | --- |
| Alt+arrows or Alt+H/J/K/L | Move to the next cell, including an empty one |
| Alt+Ctrl+arrows | Move the focused pane |
| Alt+Shift+left/right | Stack the pane into the neighboring column |
| Ctrl+Shift+Enter | Blank column to the right |
| Ctrl+Shift+Alt+Enter | Blank row below |
| Alt+O | Overview. Scroll to zoom, drag the background to pan |
| Alt+M | Maximize |
| Alt+Shift+G | Select the column, then Alt+Ctrl+arrows move it |
| Alt+G | Group the focused pane. Click the group to walk its panes |
| Alt+] / Alt+[ | Next or previous pane in the group |
| Alt+Shift+Home | Return to the first pane |
| Command+K or Ctrl+K | Search panes, commands, and workspaces |
| Alt+W | Close the focused pane, or remove the blank cell you are on |
| Alt+Shift+W | Reopen the last closed pane |
| Command+[ or Ctrl+[ | Back to the previous pane |
| Command+] or Ctrl+] | Forward again |
| Escape | Leave overview, the column selection, maximize, search, or a menu |

Drag a title bar to drop a pane on another cell. Drag the right edge to resize a column, or the bottom edge to resize a split.

## Load a pane

```ts
export function mount(host, context) {
  const node = document.createElement("p");
  node.textContent = context.title;
  host.append(node);
  return () => node.remove();
}
```

`context` includes `focused`, `visible`, `maximized`, `runtimeState` (`live`, `frozen`, or `hidden`), and `presentationMode`. It also has `emit(type, detail)` and `on(type, listener)`, a small bus every pane shares. Call `on` from `mount` and use the function it returns to unsubscribe. Custom elements also receive a `tape-pane-state` event. React, Vue, and Svelte receive the same context as `tape`.

A pane can ask other panes to handle a command and read what they return. Subscribe once from `mount` or `connectedCallback`:

```ts
context.handle("sum", (event) => {
  const detail = event.detail as { left: number; right: number };
  return detail.left + detail.right;
});

const [result] = await context.command("sum", { left: 2, right: 3 }, { paneId: "ledger" });
```

`command(type, detail, target)` waits for each matching handler. `{ paneId }` addresses that pane. `{ surfaceKind }` addresses every pane of that kind. Setting both addresses that pane when its kind matches. With no target, the command reaches every mounted pane except the sender. Pass your own pane id to include it. Each handler has 5 seconds (`timeoutMs` on the target). The call resolves with one result per handler: `{ paneId, value }` when it returns, or `{ paneId, error }` when it throws or times out.

`context.workspace` can `focus(paneId)`, `close(paneId)`, or `open(pane)`. `open` returns the pane id the workspace used. `focus` and `close` leave the strip alone when that pane is not on it.

The arrangement is saved in `localStorage` under the `storageKey` you pass (`niri-js` in the demo), including named workspaces and recently closed panes. The header chip switches workspaces. **Export** downloads the current strip as JSON, and **Import** replaces that strip. `Reset` restores the original panes in the current workspace. A `?pane=` query opens on that pane.
