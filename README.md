# niri-js

A native scrolling workspace, in the spirit of [Onirigiri](https://github.com/riteofstring/onirigiri) and [niri](https://github.com/niri-wm/niri). Panes sit in columns on a horizontal strip. Opening one adds a column instead of shrinking the others. The camera scrolls to the focused pane, and overview zooms out to the whole strip.

The workspace is plain TypeScript. A pane can be HTML, a custom element, a React component, a Vue single-file component, or a Svelte component.

## Run

```bash
bun install
bun dev
```

Then open the URL Bun prints. `bun test` checks the layout engine and that each kind of pane compiles.

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
| Alt+W | Close the focused pane |
| Alt+Shift+W | Reopen the last closed pane |
| Command+[ or Ctrl+[ | Back to the previous pane |
| Command+] or Ctrl+] | Forward again |
| Escape | Leave overview, the column selection, maximize, search, or a menu |

Drag a title bar to drop a pane on another cell. Drag the right edge to resize a column, or the bottom edge to resize a split.

## Load a pane

Use **New pane**, or call `openPane` with a source:

```ts
workspace.openPane({
  paneId: "chart",
  title: "Chart",
  surfaceKind: "react",
  source: { kind: "module", url: "panes/ledger.tsx", framework: "react" },
});
```

`framework` is `react`, `vue`, `svelte`, `element`, or `auto` (chosen from the file extension). Project files are compiled by `GET /_tape/compile`. A remote module must export `mount(host, context)`.

```ts
export function mount(host, context) {
  const node = document.createElement("p");
  node.textContent = context.title;
  host.append(node);
  return () => node.remove();
}
```

`context` includes `focused`, `visible`, `maximized`, `runtimeState` (`live`, `frozen`, or `hidden`), and `presentationMode`. It also has `emit(type, detail)` and `on(type, listener)`, a small bus every pane shares. Call `on` from `mount` and use the function it returns to unsubscribe. Custom elements also receive a `tape-pane-state` event.

These sources work too:

- `{ kind: "html", html }`
- `{ kind: "element", tag: "my-widget" }`
- `{ kind: "react" | "vue" | "svelte", component }`
- `{ kind: "mount", mount }`

The arrangement is saved in `localStorage` under `niri-js`, including named workspaces and recently closed panes. The header chip switches workspaces. **Export** downloads the current strip as JSON, and **Import** replaces that strip. `Reset` restores the original panes in the current workspace. A `?pane=` query opens on that pane.
