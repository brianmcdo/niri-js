import type { PaneContext, PaneFramework, PaneHandle, PaneMount, PaneSource } from "./types.ts";

const nativeImport = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<Record<string, unknown>>;

/** Mount whatever a pane asked for. The workspace itself stays framework-free. */
export async function mountPane(
  host: HTMLElement,
  source: PaneSource,
  context: PaneContext,
): Promise<PaneHandle> {
  switch (source.kind) {
    case "html":
      host.innerHTML = source.html;
      return inert();
    case "element":
      return mountElement(host, source.tag, context);
    case "module":
      return mountModule(host, resolveModuleUrl(source.url, source.framework), context);
    case "mount":
      host.replaceChildren();
      return asHandle(await source.mount(host, context));
    case "react":
      return mountReact(host, source.component, context);
    case "vue":
      return mountVue(host, source.component, context);
    case "svelte":
      return mountSvelte(host, source.component, context);
  }
}

export function resolveModuleUrl(url: string, framework?: PaneFramework): string {
  if (/^(https?:)?\/\//.test(url) || url.startsWith("/") || url.startsWith("blob:") || url.startsWith("data:")) {
    return url;
  }
  const params = new URLSearchParams({ file: url });
  if (framework && framework !== "auto") params.set("framework", framework);
  return `/_tape/compile?${params}`;
}

async function mountModule(host: HTMLElement, url: string, context: PaneContext): Promise<PaneHandle> {
  let imported: Record<string, unknown>;
  try {
    imported = await nativeImport(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not import ${url}. ${message}`);
  }
  if (typeof imported.mount === "function") {
    host.replaceChildren();
    return asHandle(await (imported.mount as PaneMount)(host, context));
  }
  const ctor = imported.default ?? imported.element;
  const tag = typeof imported.tag === "string" ? imported.tag : undefined;
  if (typeof ctor === "function" && HTMLElement.isPrototypeOf(ctor)) {
    return defineAndMount(host, ctor as CustomElementConstructor, tag, context);
  }
  throw new Error(
    "This module does not export mount(host, context) or a custom element. Open a local .tsx, .vue, .svelte, or element file so Tape can wrap it.",
  );
}

async function mountElement(host: HTMLElement, tag: string, context: PaneContext): Promise<PaneHandle> {
  if (!tag.includes("-")) throw new Error(`<${tag}> is not a custom element name.`);
  if (!customElements.get(tag)) {
    await Promise.race([
      customElements.whenDefined(tag),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  }
  const ctor = customElements.get(tag);
  if (!ctor) {
    throw new Error(`<${tag}> is not defined. Load the file that registers it, or pass that file as a module.`);
  }
  return defineAndMount(host, ctor, tag, context);
}

function defineAndMount(
  host: HTMLElement,
  ctor: CustomElementConstructor,
  tag: string | undefined,
  context: PaneContext,
): PaneHandle {
  const name = tag && tag.includes("-") ? tag : undefined;
  if (name && !customElements.get(name)) customElements.define(name, ctor);
  const resolved = name ?? customElementName(ctor);
  if (!resolved) throw new Error("Export a hyphenated tag name with the custom element.");
  host.replaceChildren();
  const element = document.createElement(resolved);
  host.append(element);
  const apply = (next: PaneContext) => {
    const target = element as HTMLElement & Record<string, unknown>;
    target.tape = next;
    for (const [key, value] of Object.entries(next.props)) target[key] = value;
    element.dispatchEvent(new CustomEvent("tape-pane-state", { detail: next }));
  };
  apply(context);
  return { update: apply, destroy: () => element.remove() };
}

async function mountReact(host: HTMLElement, component: unknown, context: PaneContext): Promise<PaneHandle> {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  host.replaceChildren();
  const root = createRoot(host);
  const Component = component as React.ComponentType<Record<string, unknown>>;
  const render = (next: PaneContext) => {
    root.render(React.createElement(Component, { ...next.props, ...viewProps(next) }));
  };
  render(context);
  return { update: render, destroy: () => root.unmount() };
}

async function mountVue(host: HTMLElement, component: unknown, context: PaneContext): Promise<PaneHandle> {
  const { createApp, h, reactive } = await import("vue");
  host.replaceChildren();
  const state = reactive({ ...context.props, ...viewProps(context) });
  const app = createApp({
    name: "TapeVueHost",
    setup: () => () => h(component as never, state),
  });
  app.mount(host);
  return {
    update(next) {
      Object.assign(state, next.props, viewProps(next));
    },
    destroy: () => app.unmount(),
  };
}

async function mountSvelte(host: HTMLElement, component: unknown, context: PaneContext): Promise<PaneHandle> {
  const { createClassComponent } = await import("svelte/legacy");
  host.replaceChildren();
  const instance = createClassComponent({
    component: component as never,
    target: host,
    props: { ...context.props, ...viewProps(context) },
  });
  return {
    update: (next) => instance.$set({ ...next.props, ...viewProps(next) }),
    destroy: () => instance.$destroy(),
  };
}

function viewProps(context: PaneContext) {
  return {
    paneId: context.paneId,
    title: context.title,
    surfaceKind: context.surfaceKind,
    data: context.data,
    focused: context.focused,
    visible: context.visible,
    maximized: context.maximized,
    runtimeState: context.runtimeState,
    presentationMode: context.presentationMode,
    tape: context,
  };
}

function customElementName(ctor: CustomElementConstructor): string | undefined {
  const tagged = ctor as CustomElementConstructor & { tag?: string };
  return typeof tagged.tag === "string" && tagged.tag.includes("-") ? tagged.tag : undefined;
}

function asHandle(value: void | (() => void) | PaneHandle): PaneHandle {
  if (typeof value === "function") return { update() {}, destroy: value };
  if (value && typeof value.destroy === "function") return value;
  return inert();
}

function inert(): PaneHandle {
  return { update() {}, destroy() {} };
}
