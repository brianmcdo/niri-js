# niri-js

A scrolling workspace of panes for the browser. Panes sit in columns on a horizontal strip. Opening one adds a column. The camera scrolls to the focused pane. Overview zooms out to the whole strip.

The published package is plain TypeScript. React, Vue, and Svelte are optional peers, loaded only when a pane of that kind mounts.

## Commands

Use Bun. Do not add Node, npm, pnpm, Vite, webpack, or Express.

```sh
bun install
bun dev          # demo server, hot reload. Open the URL it prints.
bun test         # layout, session, host, and pane compile
bun check        # typecheck from tsconfig.json
bun run build    # browser ESM + CSS + .d.ts into dist/
```

`bunfig.toml` preloads happy-dom for every test. Tests import from `bun:test`.

## Layout of the repo

| Path | Role |
| --- | --- |
| `src/index.ts` | Public exports. This is the package entry. |
| `src/types.ts` | Pane, layout, and scene types. `LAYOUT_SCHEMA` is `1`. |
| `src/layout/` | Pure functions. No DOM. |
| `src/workspace/` | `TapeWorkspace`, shortcuts, spotlight, session, focus history, pane bus. |
| `src/host/` | Mounts a pane. The only place that talks to React, Vue, or Svelte. |
| `src/styles.css` | Workspace CSS. Published as `niri-js/styles.css`. |
| `src/demo/` | Dev-server compiler. Not part of the package. |
| `panes/` | Sample panes the demo compiles. |
| `index.ts` | `Bun.serve` for the demo. `GET /_tape/compile` is demo-only. |
| `scripts/build.ts` | Package build. It refuses a bad `dist/`. |

A consumer mounts a component or a module URL. The `/_tape/compile` route exists only while `bun dev` is running.

## Invariants

- Layout changes go through `src/layout/layout.ts`. Coordinates stay stable: closing a pane does not renumber the rest. `assertLayout` rejects anything that is not schema `1`.
- `src/layout/` and `src/types.ts` stay free of DOM and frameworks. `TapeWorkspace` renders the scene those functions return.
- `src/host/host.ts` dynamically imports `react`, `vue`, and `svelte`. Keep those imports inside the mount functions so a page that never opens that kind of pane does not load the framework. Do not add them as hard dependencies.
- `mount` sources stay in memory. Session JSON in `src/workspace/session.ts` is schema `2` and still reads schema `1`. `storageKey: null` keeps the arrangement in memory only.
- A pane module exports `mount(host, context)` or a custom element. `context` carries focus, visibility, `runtimeState` (`live`, `frozen`, `hidden`), `presentationMode`, and the shared bus (`emit` / `on`).
- Library CSS is scoped under `.tape`. `scripts/build.ts` fails if `src/styles.css` styles `html` or `body`.
- The package build externalizes dependencies. It fails if the demo compiler, `Bun.build`, or `Bun.file` ends up in `dist/index.js`.

## Conventions

- ESM with `.ts` import specifiers. `verbatimModuleSyntax` is on: use `import type` for types.
- `noUncheckedIndexedAccess` is on. Index a collection only after a check, or use `!` when the test just proved the slot exists.
- New behavior gets a test next to the module (`layout.test.ts`, `workspace.test.ts`, `host.test.ts`, `compile.test.ts`). Layout tests stay pure. Workspace and host tests use the happy-dom document.
- Public types leave through `src/index.ts`. Demo helpers stay in `src/demo/`.

## After a change

Run `bun test` and `bun check`. Run `bun run build` when the change touches the public entry, CSS, or anything `scripts/build.ts` asserts about `dist/`.
