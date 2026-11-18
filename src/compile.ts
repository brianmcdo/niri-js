import { resolve, sep } from "node:path";
import { frameworkPlugins } from "./framework-plugins.ts";
import type { PaneFramework } from "./types.ts";

const root = resolve(import.meta.dir, "..");
const cache = new Map<string, { mtimeMs: number; code: string }>();

const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".vue", ".svelte"]);

/** Bundle a project file into a browser module that exports `mount(host, context)`. */
export async function compilePaneRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const file = url.searchParams.get("file");
  if (!file) return text("Missing file.", 400);
  try {
    const code = await compilePane(file, frameworkFor(file, url.searchParams.get("framework")));
    return new Response(code, {
      headers: {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return text(message, 400);
  }
}

export async function compilePane(file: string, framework: Exclude<PaneFramework, "auto">): Promise<string> {
  const absolute = resolve(root, file);
  if (absolute !== root && !absolute.startsWith(root + sep)) {
    throw new Error("Pane file is outside the project.");
  }
  if (absolute.includes(`${sep}node_modules${sep}`)) throw new Error("Pane file is not allowed.");
  const extension = absolute.slice(absolute.lastIndexOf("."));
  if (!extensions.has(extension)) throw new Error(`Cannot load a ${extension || "extensionless"} pane.`);
  const disk = Bun.file(absolute);
  if (!(await disk.exists())) throw new Error(`No pane at ${file}.`);
  const mtimeMs = disk.lastModified;
  const key = `${absolute}\0${framework}`;
  const cached = cache.get(key);
  if (cached && cached.mtimeMs === mtimeMs) return cached.code;

  const wrapper = resolve(root, ".tape-cache", "wrappers", `${Bun.hash(`${key}:${mtimeMs}`).toString(16)}.js`);
  await Bun.write(wrapper, wrapperSource(absolute, framework));
  const built = await Bun.build({
    entrypoints: [wrapper],
    plugins: frameworkPlugins,
    target: "browser",
    format: "esm",
  });
  if (!built.success) {
    throw new Error(built.logs.map((log) => log.message).join("\n") || "Pane build failed.");
  }
  const entry = built.outputs.find((output) => output.kind === "entry-point") ?? built.outputs[0];
  if (!entry) throw new Error("Pane build produced no output.");
  let code = await entry.text();
  const css = (
    await Promise.all(
      built.outputs
        .filter((output) => output.path.endsWith(".css") || output.kind === "asset" && output.path.endsWith(".css"))
        .map((output) => output.text()),
    )
  ).join("\n");
  if (css.trim()) {
    code += `\n;(() => { const style = document.createElement("style"); style.textContent = ${JSON.stringify(css)}; document.head.appendChild(style); })();\n`;
  }
  cache.set(key, { mtimeMs, code });
  return code;
}

export function frameworkFor(file: string, requested: string | null): Exclude<PaneFramework, "auto"> {
  if (requested === "react" || requested === "vue" || requested === "svelte" || requested === "element") {
    return requested;
  }
  if (file.endsWith(".vue")) return "vue";
  if (file.endsWith(".svelte")) return "svelte";
  if (file.endsWith(".tsx") || file.endsWith(".jsx")) return "react";
  return "element";
}

function wrapperSource(absolute: string, framework: Exclude<PaneFramework, "auto">): string {
  const spec = JSON.stringify(absolute);
  if (framework === "react") return reactWrapper(spec);
  if (framework === "vue") return vueWrapper(spec);
  if (framework === "svelte") return svelteWrapper(spec);
  return elementWrapper(spec);
}

function propsHelper(): string {
  return `function tapeProps(context) {
  return {
    ...(context.props ?? {}),
    paneId: context.paneId,
    title: context.title,
    surfaceKind: context.surfaceKind,
    data: context.data,
    focused: !!context.focused,
    visible: !!context.visible,
    maximized: !!context.maximized,
    runtimeState: context.runtimeState,
    presentationMode: context.presentationMode,
    tape: context,
  };
}`;
}

function reactWrapper(spec: string): string {
  return `import React from "react";
import { createRoot } from "react-dom/client";
import Component from ${spec};
${propsHelper()}
class TapeBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      const message = this.state.error && this.state.error.stack ? this.state.error.stack : String(this.state.error);
      return React.createElement("pre", { className: "tape-mount-error" }, message);
    }
    return React.createElement(Component, this.props.paneProps);
  }
}
export function mount(host, context) {
  const root = createRoot(host);
  const render = (next) => {
    root.render(React.createElement(TapeBoundary, { paneProps: tapeProps(next) }));
  };
  render(context);
  return { update: render, destroy() { root.unmount(); } };
}
`;
}

function vueWrapper(spec: string): string {
  return `import { createApp, h, reactive } from "vue";
import Component from ${spec};
${propsHelper()}
export function mount(host, context) {
  const state = reactive(tapeProps(context));
  const app = createApp({
    name: "TapeVueHost",
    setup() {
      return () => h(Component, state);
    },
  });
  app.config.errorHandler = (error) => {
    host.replaceChildren();
    const pre = document.createElement("pre");
    pre.className = "tape-mount-error";
    pre.textContent = error instanceof Error ? error.stack ?? error.message : String(error);
    host.append(pre);
  };
  app.mount(host);
  return {
    update(next) {
      const props = tapeProps(next);
      for (const key of Object.keys(state)) {
        if (!(key in props)) delete state[key];
      }
      Object.assign(state, props);
    },
    destroy() { app.unmount(); },
  };
}
`;
}

function svelteWrapper(spec: string): string {
  return `import Component from ${spec};
import { createClassComponent } from "svelte/legacy";
${propsHelper()}
export function mount(host, context) {
  const component = createClassComponent({
    component: Component,
    target: host,
    props: tapeProps(context),
  });
  return {
    update(next) { component.$set(tapeProps(next)); },
    destroy() { component.$destroy(); },
  };
}
`;
}

function elementWrapper(spec: string): string {
  return `import * as mod from ${spec};
${propsHelper()}
const Ctor = mod.default ?? mod.element;
export function mount(host, context) {
  if (typeof mod.mount === "function") return mod.mount(host, context);
  if (typeof Ctor !== "function" || !HTMLElement.isPrototypeOf(Ctor)) {
    throw new Error("This module must export mount() or a custom element class.");
  }
  const name = typeof mod.tag === "string" ? mod.tag : Ctor.tag;
  if (typeof name !== "string" || !name.includes("-")) {
    throw new Error("Export a hyphenated tag name alongside the custom element.");
  }
  if (!customElements.get(name)) customElements.define(name, Ctor);
  const element = document.createElement(name);
  host.append(element);
  const apply = (next) => {
    const props = tapeProps(next);
    element.tape = props.tape;
    for (const [key, value] of Object.entries(props)) {
      if (key === "tape") continue;
      element[key] = value;
    }
    element.dispatchEvent(new CustomEvent("tape-pane-state", { detail: props.tape }));
  };
  apply(context);
  return { update: apply, destroy() { element.remove(); } };
}
`;
}

function text(message: string, status: number): Response {
  return new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}
