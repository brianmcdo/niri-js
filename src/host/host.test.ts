import { createElement } from "react";
import { h, nextTick } from "vue";
import { beforeAll, expect, test } from "bun:test";
import { compile } from "svelte/compiler";
import { mountPane, resolveModuleUrl } from "./host.ts";
import type { PaneContext } from "../types.ts";

function context(overrides: Partial<PaneContext> = {}): PaneContext {
  return {
    paneId: "pane",
    title: "Pane",
    surfaceKind: "demo",
    focused: true,
    visible: true,
    maximized: false,
    runtimeState: "live",
    presentationMode: "normal",
    props: {},
    emit() {},
    on: () => () => {},
    ...overrides,
  };
}

function host(): HTMLElement {
  const node = document.createElement("div");
  document.body.append(node);
  return node;
}

function paint(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("resolveModuleUrl leaves absolute urls alone and compiles project files", () => {
  expect(resolveModuleUrl("https://example.com/pane.js")).toBe("https://example.com/pane.js");
  expect(resolveModuleUrl("//cdn.example/pane.js")).toBe("//cdn.example/pane.js");
  expect(resolveModuleUrl("/panes/ready.js")).toBe("/panes/ready.js");
  expect(resolveModuleUrl("blob:pane")).toBe("blob:pane");
  expect(resolveModuleUrl("data:text/javascript,export default 1")).toBe("data:text/javascript,export default 1");
  expect(resolveModuleUrl("panes/ledger.tsx")).toBe("/_tape/compile?file=panes%2Fledger.tsx");
  expect(resolveModuleUrl("panes/palette.vue", "vue")).toBe(
    "/_tape/compile?file=panes%2Fpalette.vue&framework=vue",
  );
  expect(resolveModuleUrl("panes/notes.svelte", "auto")).toBe("/_tape/compile?file=panes%2Fnotes.svelte");
});

test("html is placed in the host", async () => {
  const node = host();
  const handle = await mountPane(node, { kind: "html", html: "<p>hello</p>" }, context());
  expect(node.querySelector("p")?.textContent).toBe("hello");
  handle.update(context({ title: "Ignored" }));
  handle.destroy();
  expect(node.querySelector("p")?.textContent).toBe("hello");
});

test("a mount function can return a cleanup or a handle", async () => {
  const node = host();
  let destroyed = false;
  const cleanup = await mountPane(
    node,
    {
      kind: "mount",
      mount(target) {
        target.textContent = "mounted";
        return () => {
          destroyed = true;
        };
      },
    },
    context(),
  );
  expect(node.textContent).toBe("mounted");
  cleanup.destroy();
  expect(destroyed).toBe(true);

  const updates: string[] = [];
  const handle = await mountPane(
    node,
    {
      kind: "mount",
      mount: async (target, next) => {
        target.textContent = next.title;
        return {
          update: (later) => updates.push(later.title),
          destroy: () => {
            target.textContent = "";
          },
        };
      },
    },
    context({ title: "First" }),
  );
  handle.update(context({ title: "Second" }));
  expect(updates).toEqual(["Second"]);
  handle.destroy();
  expect(node.textContent).toBe("");
});

test("a custom element receives pane state and can be updated", async () => {
  const node = host();
  const events: string[] = [];
  class Probe extends HTMLElement {
    accent = "";
    connectedCallback() {
      this.addEventListener("tape-pane-state", ((event: CustomEvent<PaneContext>) => {
        events.push(`${event.detail.title}:${event.detail.focused}`);
        this.textContent = `${this.accent}:${event.detail.runtimeState}`;
      }) as EventListener);
    }
  }
  customElements.define("tape-host-probe", Probe);

  const handle = await mountPane(
    node,
    { kind: "element", tag: "tape-host-probe", props: { accent: "gold" } },
    context({ title: "Clock", runtimeState: "live", props: { accent: "gold" } }),
  );
  const element = node.querySelector("tape-host-probe");
  expect(element?.textContent).toBe("gold:live");
  expect(events).toEqual(["Clock:true"]);
  handle.update(context({ title: "Clock", focused: false, runtimeState: "hidden" }));
  expect(element?.textContent).toBe("gold:hidden");
  handle.destroy();
  expect(node.querySelector("tape-host-probe")).toBeNull();
});

test("an element tag that is defined while mounting still attaches", async () => {
  const node = host();
  const pending = mountPane(node, { kind: "element", tag: "tape-host-late" }, context());
  customElements.define("tape-host-late", class extends HTMLElement {
    connectedCallback() {
      this.textContent = "late";
    }
  });
  await pending;
  expect(node.querySelector("tape-host-late")?.textContent).toBe("late");
});

test("element mounts reject a plain tag and a tag that never registers", async () => {
  const node = host();
  await expect(mountPane(node, { kind: "element", tag: "div" }, context())).rejects.toThrow(/custom element/);
  await expect(mountPane(node, { kind: "element", tag: "tape-host-missing" }, context())).rejects.toThrow(
    /not defined/,
  );
}, 4_000);

test("a module that exports mount is loaded from an absolute path", async () => {
  const node = host();
  const url = new URL("./fixtures/mount-pane.ts", import.meta.url).pathname;
  const handle = await mountPane(node, { kind: "module", url }, context({ title: "Notes", focused: true }));
  expect(node.querySelector(".module-pane")?.textContent).toBe("Notes:true");
  handle.update(context({ title: "Notes", focused: false }));
  expect(node.querySelector(".module-pane")?.textContent).toBe("Notes:false");
  handle.destroy();
  expect(node.querySelector(".module-pane")).toBeNull();
});

test("a module without mount or an element fails, and a missing file fails", async () => {
  const node = host();
  const empty = new URL("./fixtures/empty-module.ts", import.meta.url).pathname;
  await expect(mountPane(node, { kind: "module", url: empty }, context())).rejects.toThrow(/does not export mount/);
  await expect(mountPane(node, { kind: "module", url: "/no/such/tape-pane.ts" }, context())).rejects.toThrow(
    /Could not import/,
  );
});

test("react, vue, and svelte components render and accept new pane state", async () => {
  const reactHost = host();
  function Badge(props: { title?: string; focused?: boolean }) {
    return createElement("p", { className: "react-pane" }, `${props.title}:${String(props.focused)}`);
  }
  const react = await mountPane(reactHost, { kind: "react", component: Badge }, context({ title: "Ledger" }));
  await paint();
  expect(reactHost.querySelector(".react-pane")?.textContent).toBe("Ledger:true");
  react.update(context({ title: "Ledger", focused: false }));
  await paint();
  expect(reactHost.querySelector(".react-pane")?.textContent).toBe("Ledger:false");
  react.destroy();
  expect(reactHost.querySelector(".react-pane")).toBeNull();

  const vueHost = host();
  const vue = await mountPane(
    vueHost,
    {
      kind: "vue",
      component: {
        props: ["title", "focused"],
        setup(props: { title: string; focused: boolean }) {
          return () => h("p", { class: "vue-pane" }, `${props.title}:${String(props.focused)}`);
        },
      },
    },
    context({ title: "Palette" }),
  );
  await nextTick();
  expect(vueHost.querySelector(".vue-pane")?.textContent).toBe("Palette:true");
  vue.update(context({ title: "Palette", focused: false }));
  await nextTick();
  expect(vueHost.querySelector(".vue-pane")?.textContent).toBe("Palette:false");
  vue.destroy();
  expect(vueHost.querySelector(".vue-pane")).toBeNull();

  const svelteHost = host();
  const svelte = await mountPane(
    svelteHost,
    { kind: "svelte", component: SveltePane },
    context({ title: "Notes" }),
  );
  expect(svelteHost.querySelector(".svelte-pane")?.textContent).toBe("Notes:true");
  svelte.update(context({ title: "Notes", focused: false }));
  await paint();
  expect(svelteHost.querySelector(".svelte-pane")?.textContent).toBe("Notes:false");
  svelte.destroy();
  expect(svelteHost.querySelector(".svelte-pane")).toBeNull();
});

let SveltePane: unknown;

beforeAll(async () => {
  const result = compile(
    `<script>
      let { title = "", focused = false } = $props();
    </script>
    <p class="svelte-pane">{title}:{focused}</p>`,
    { filename: "SveltePane.svelte", generate: "client", css: "injected" },
  );
  const file = new URL("../../.tape-cache/svelte-pane-fixture.js", import.meta.url);
  await Bun.write(file, result.js.code);
  SveltePane = (await import(file.href)).default;
});
