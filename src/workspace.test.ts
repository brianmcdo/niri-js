import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { TapeWorkspace } from "./workspace.ts";
import type { PaneDefinition } from "./types.ts";

const proto = HTMLElement.prototype;
const ownWidth = Object.getOwnPropertyDescriptor(proto, "clientWidth");
const ownHeight = Object.getOwnPropertyDescriptor(proto, "clientHeight");
const stageSize = { width: 1200, height: 800 };
const open: TapeWorkspace[] = [];

beforeAll(() => {
  if (!ownWidth?.get || !ownHeight?.get) throw new Error("happy-dom did not provide clientWidth.");
  const widthGetter = ownWidth.get;
  const heightGetter = ownHeight.get;
  Object.defineProperty(proto, "clientWidth", {
    configurable: true,
    get() {
      return this.classList?.contains("tape-stage") ? stageSize.width : widthGetter.call(this);
    },
  });
  Object.defineProperty(proto, "clientHeight", {
    configurable: true,
    get() {
      return this.classList?.contains("tape-stage") ? stageSize.height : heightGetter.call(this);
    },
  });
  window.matchMedia = (query: string) =>
    ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    }) as MediaQueryList;
});

afterAll(() => {
  if (ownWidth) Object.defineProperty(proto, "clientWidth", ownWidth);
  if (ownHeight) Object.defineProperty(proto, "clientHeight", ownHeight);
});

afterEach(() => {
  for (const workspace of open) workspace.destroy();
  open.length = 0;
  document.body.replaceChildren();
  localStorage.clear();
  history.replaceState(null, "", "/");
});

function pane(id: string, html = `<p>${id}</p>`): PaneDefinition {
  const title = id.slice(0, 1).toUpperCase() + id.slice(1);
  return { paneId: id, title, surfaceKind: id, source: { kind: "html", html } };
}

function create(options: ConstructorParameters<typeof TapeWorkspace>[1] = {}): TapeWorkspace {
  const container = document.createElement("div");
  document.body.append(container);
  const workspace = new TapeWorkspace(container, { storageKey: null, paneLink: false, ...options });
  open.push(workspace);
  return workspace;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await new Promise((resolve) => requestAnimationFrame(resolve));
}

function root(): HTMLElement {
  const node = document.querySelector<HTMLElement>(".tape");
  if (!node) throw new Error("workspace did not render");
  return node;
}

function press(key: string, init: KeyboardEventInit = {}): void {
  root().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
}

function button(name: string): HTMLButtonElement {
  const match = [...root().querySelectorAll("button")].find(
    (item) => item.textContent === name || item.getAttribute("aria-label")?.startsWith(name),
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`No button named ${name}.`);
  return match;
}

test("the strip mounts every pane and centers the focused column", async () => {
  create({ panes: [pane("guide", "<p>welcome</p>"), pane("clock"), pane("ledger")] });
  await flush();
  const panes = [...root().querySelectorAll<HTMLElement>(".tape-pane")];
  expect(panes.map((item) => item.dataset.paneId)).toEqual(["guide", "clock", "ledger"]);
  expect(panes[0]?.querySelector("p")?.textContent).toBe("welcome");
  expect(panes[0]?.classList.contains("is-focused")).toBe(true);
  expect(panes[0]?.style.width).toBe("672px");
  expect(root().querySelector(".tape-world")?.getAttribute("style")).toMatch(/^transform: scale\(1\) translate3d\(/);
  expect(root().querySelector(".tape-status")?.textContent).toBe("Guide. Column 1 of 3.");
});

test("buttons and option-arrow keys move focus and the pane link", async () => {
  const workspace = create({
    paneLink: true,
    panes: [pane("guide"), pane("clock"), pane("ledger")],
  });
  await flush();
  button("Focus right").click();
  expect(workspace.getLayout().cursor).toEqual({ plane: 0, column: 1, row: 0 });
  expect(location.search).toBe("?pane=clock");
  expect(root().querySelector(".tape-status")?.textContent).toBe("Clock. Column 2 of 3.");

  press("ArrowLeft", { altKey: true });
  expect(workspace.getLayout().cursor.column).toBe(0);
  expect(location.search).toBe("?pane=guide");
});

test("a keypress inside a field does not move the workspace", async () => {
  const workspace = create({ panes: [pane("guide", '<input id="note" />'), pane("clock")] });
  await flush();
  const input = root().querySelector("input");
  input?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true, bubbles: true, cancelable: true }));
  expect(workspace.getLayout().cursor.column).toBe(0);
});

test("opening a pane inserts a column and suffixes a duplicate id", async () => {
  const changes: number[] = [];
  const workspace = create({
    panes: [pane("guide")],
    onLayoutChange: (layout) => changes.push(layout.planes[0]?.columns.length ?? 0),
  });
  await flush();
  const id = workspace.openPane(pane("guide", "<p>again</p>"));
  await flush();
  expect(id).toBe("guide-2");
  expect(workspace.getLayout().cursor.column).toBe(1);
  expect(root().querySelector('[data-pane-id="guide-2"] p')?.textContent).toBe("again");
  expect(changes.at(-1)).toBe(2);
});

test("closing the focused pane leaves the neighbor focused", async () => {
  const workspace = create({ panes: [pane("guide"), pane("clock")] });
  await flush();
  root().querySelector<HTMLButtonElement>('[data-pane-id="guide"] [aria-label="Close"]')?.click();
  expect(workspace.getLayout().planes[0]?.columns).toHaveLength(1);
  expect(root().querySelector('[data-pane-id="guide"]')).toBeNull();
  expect(root().querySelector(".tape-status")?.textContent).toBe("Clock. Column 1 of 1.");
});

test("split, overview, maximize, and escape walk back out", async () => {
  const workspace = create({ panes: [pane("guide"), pane("clock")], liveContent: false });
  await flush();
  button("Overview").click();
  await flush();
  expect(root().classList.contains("is-overview")).toBe(true);
  expect(button("Overview").getAttribute("aria-pressed")).toBe("true");
  expect(root().querySelector(".tape-minimap")?.hasAttribute("hidden")).toBe(true);
  expect(root().querySelector(".tape-world")?.getAttribute("style")).toMatch(/scale\(0\./);
  expect(root().querySelector<HTMLElement>(".tape-pane.is-focused")?.dataset.runtime).toBe("frozen");

  press("Escape");
  expect(root().classList.contains("is-overview")).toBe(false);

  button("Split").click();
  expect(root().querySelector(".tape-ghost")?.textContent).toContain("Empty");
  expect(root().querySelector(".tape-status")?.textContent).toContain("Empty cell");

  press("Home", { altKey: true, shiftKey: true });
  expect(workspace.getLayout().maximizedPaneId).toBeNull();

  press("m", { altKey: true, code: "KeyM" });
  expect(root().classList.contains("is-maximized")).toBe(true);
  expect(root().querySelector(".tape-world")?.getAttribute("style")).toContain("transform: none");
  expect(root().querySelector('[data-pane-id="clock"]')?.hasAttribute("hidden")).toBe(true);
  press("Escape");
  expect(workspace.getLayout().maximizedPaneId).toBeNull();
});

test("selecting a column group and moving it swaps the columns", async () => {
  const workspace = create({ panes: [pane("guide"), pane("clock")] });
  await flush();
  press("g", { altKey: true, shiftKey: true, code: "KeyG" });
  expect(root().querySelector('[data-pane-id="guide"]')?.classList.contains("is-group")).toBe(true);
  press("ArrowRight", { altKey: true, ctrlKey: true, shiftKey: true });
  const columns = workspace.getLayout().planes[0]?.columns ?? [];
  expect(columns.find((column) => column.index === 1)?.cells[0]?.paneId).toBe("guide");
  expect(columns.find((column) => column.index === 0)?.cells[0]?.paneId).toBe("clock");
  press("Escape");
  expect(root().querySelector(".is-group")).toBeNull();
});

test("dragging the right edge resizes that column only", async () => {
  const workspace = create({ panes: [pane("guide"), pane("clock")] });
  await flush();
  const handle = root().querySelector<HTMLElement>('[data-pane-id="guide"] [data-edge="right"]');
  if (!handle || typeof root().querySelector(".tape-stage")?.setPointerCapture !== "function") return;
  handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1, clientX: 100, button: 0 }));
  window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: 180 }));
  window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, clientX: 180 }));
  const columns = workspace.getLayout().planes[0]?.columns ?? [];
  expect(columns.find((column) => column.index === 0)?.widthPx).toBe(752);
  expect(columns.find((column) => column.index === 1)?.widthPx).toBe(672);
});

test("the new pane dialog loads html and ignores an empty source", async () => {
  const workspace = create({ panes: [pane("guide"), pane("clock")] });
  await flush();
  button("New pane").click();
  const dialog = root().querySelector("dialog");
  expect(dialog?.open).toBe(true);
  const form = dialog?.querySelector("form");
  const select = form?.querySelector("select");
  const source = form?.querySelector<HTMLInputElement>('input[name="source"]');
  const title = form?.querySelector<HTMLInputElement>('input[name="title"]');
  if (!form || !select || !source || !title) throw new Error("dialog is missing fields");
  select.value = "html";
  select.dispatchEvent(new Event("change"));
  expect(form.querySelector(".tape-dialog-help")?.textContent).toMatch(/Markup/);
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  expect(dialog?.open).toBe(true);

  title.value = "Scratch Pad";
  source.value = "<p>scratched</p>";
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await flush();
  expect(dialog?.open).toBe(false);
  expect(root().querySelector('[data-pane-id="scratch-pad"] p')?.textContent).toBe("scratched");
  expect(workspace.getLayout().cursor.column).toBe(1);
});

test("a sample in the dialog opens another copy of that pane", async () => {
  create({ panes: [pane("guide"), pane("clock", "<p>tick</p>")] });
  await flush();
  button("New pane").click();
  const sample = [...root().querySelectorAll<HTMLButtonElement>("dialog button")].find(
    (item) => item.textContent === "Clock",
  );
  sample?.click();
  await flush();
  expect(root().querySelector('[data-pane-id="clock-2"] p')?.textContent).toBe("tick");
});

test("a mount error is shown in the pane", async () => {
  create({
    panes: [
      {
        paneId: "broken",
        title: "Broken",
        surfaceKind: "mount",
        source: {
          kind: "mount",
          mount() {
            throw new Error("compiler exploded");
          },
        },
      },
    ],
  });
  await flush();
  expect(root().querySelector(".tape-mount-error")?.textContent).toBe("compiler exploded");
});

test("focus updates the mounted context", async () => {
  const seen: string[] = [];
  create({
    panes: [
      pane("guide"),
      {
        paneId: "live",
        title: "Live",
        surfaceKind: "mount",
        source: {
          kind: "mount",
          mount(_host, next) {
            seen.push(`${next.focused}:${next.presentationMode}`);
            return {
              update(later) {
                seen.push(`${later.focused}:${later.presentationMode}`);
              },
              destroy() {},
            };
          },
        },
      },
    ],
  });
  await flush();
  button("Focus right").click();
  await flush();
  expect(seen.at(-1)).toBe("true:normal");
});

test("a narrow stage shows only the focused pane", async () => {
  create({ panes: [pane("guide"), pane("clock")], compactBreakpoint: 2000 });
  await flush();
  expect(root().classList.contains("is-compact")).toBe(true);
  expect(root().querySelector('[data-pane-id="guide"]')?.hasAttribute("hidden")).toBe(false);
  expect(root().querySelector('[data-pane-id="clock"]')?.hasAttribute("hidden")).toBe(true);
  expect(root().querySelector<HTMLElement>('[data-pane-id="guide"]')?.style.width).toBe("1200px");
  expect(root().querySelector(".tape-minimap")?.hasAttribute("hidden")).toBe(true);
});

test("storage restores serializable panes and drops the rest", async () => {
  const key = "tape-test-persist";
  const first = create({
    storageKey: key,
    panes: [pane("guide", "<p>welcome</p>"), pane("clock")],
  });
  await flush();
  first.openPane({
    paneId: "live",
    title: "Live",
    surfaceKind: "mount",
    source: { kind: "mount", mount(node) { node.textContent = "live"; } },
  });
  first.openPane(pane("extra", "<p>extra</p>"));
  await flush();
  first.destroy();
  open.pop();

  const saved = JSON.parse(localStorage.getItem(key) ?? "{}") as { panes?: { paneId: string }[] };
  expect(saved.panes?.map((item) => item.paneId)).toEqual(["guide", "clock", "extra"]);

  history.replaceState(null, "", "/?pane=extra");
  const second = create({ storageKey: key, panes: [pane("guide"), pane("clock")] });
  await flush();
  expect(second.getLayout().cursor.column).toBe(2);
  expect(root().querySelector('[data-pane-id="extra"] p')?.textContent).toBe("extra");
  expect(root().querySelector('[data-pane-id="live"]')).toBeNull();

  button("Reset").click();
  await flush();
  expect(second.getLayout().planes[0]?.columns).toHaveLength(2);
  expect(root().querySelector('[data-pane-id="extra"]')).toBeNull();
  expect(root().querySelector(".tape-status")?.textContent).toBe("Guide. Column 1 of 2.");
});

test("corrupt storage is discarded for the original panes", async () => {
  const key = "tape-test-corrupt";
  localStorage.setItem(key, "{");
  create({ storageKey: key, panes: [pane("guide", "<p>welcome</p>")] });
  await flush();
  expect(localStorage.getItem(key)).not.toBe("{");
  expect(root().querySelector('[data-pane-id="guide"] p')?.textContent).toBe("welcome");
});

test("wheel zoom is ignored until overview is open", async () => {
  create({ panes: [pane("guide"), pane("clock")] });
  await flush();
  const stage = root().querySelector(".tape-stage");
  const idle = new WheelEvent("wheel", { deltaY: -400, bubbles: true, cancelable: true });
  stage?.dispatchEvent(idle);
  expect(idle.defaultPrevented).toBe(false);

  button("Overview").click();
  await flush();
  const before = root().querySelector(".tape-world")?.getAttribute("style") ?? "";
  const zoom = new WheelEvent("wheel", { deltaY: -400, bubbles: true, cancelable: true });
  stage?.dispatchEvent(zoom);
  await flush();
  expect(zoom.defaultPrevented).toBe(true);
  expect(root().querySelector(".tape-world")?.getAttribute("style")).not.toBe(before);
});
