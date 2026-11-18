import type { PaneBusEvent, PaneCommandResult, PaneCommandTarget } from "../types.ts";

type Listener = (event: PaneBusEvent) => void;
type CommandHandler = (event: PaneBusEvent) => unknown | Promise<unknown>;

interface Registration {
  paneId: string;
  surfaceKind: string;
  handler: CommandHandler;
}

const DEFAULT_TIMEOUT_MS = 5000;

/** A tiny channel panes share. Messages and commands stay on separate maps. */
export class PaneBus {
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly handlers = new Map<string, Set<Registration>>();

  emit(sourceId: string, type: string, detail?: unknown): void {
    const name = type.trim();
    if (!name) return;
    const event: PaneBusEvent = { type: name, detail, sourceId };
    for (const listener of this.listeners.get(name) ?? []) listener(event);
  }

  on(type: string, listener: Listener): () => void {
    const name = type.trim();
    if (!name) return () => {};
    const set = this.listeners.get(name) ?? new Set();
    set.add(listener);
    this.listeners.set(name, set);
    return () => {
      set.delete(listener);
    };
  }

  handle(paneId: string, surfaceKind: string, type: string, handler: CommandHandler): () => void {
    const name = type.trim();
    if (!name) return () => {};
    const registration: Registration = { paneId, surfaceKind, handler };
    const set = this.handlers.get(name) ?? new Set();
    set.add(registration);
    this.handlers.set(name, set);
    return () => {
      set.delete(registration);
    };
  }

  async command(
    sourceId: string,
    type: string,
    detail?: unknown,
    target?: PaneCommandTarget,
  ): Promise<PaneCommandResult[]> {
    const name = type.trim();
    if (!name) return [];
    const event: PaneBusEvent = { type: name, detail, sourceId };
    const timeoutMs = timeoutOf(target);
    const matches = [...(this.handlers.get(name) ?? [])].filter((registration) =>
      addressed(registration, sourceId, target),
    );
    return Promise.all(matches.map((registration) => invoke(registration, event, timeoutMs)));
  }

  clear(): void {
    this.listeners.clear();
    this.handlers.clear();
  }
}

function addressed(registration: Registration, sourceId: string, target?: PaneCommandTarget): boolean {
  if (target?.paneId) {
    if (registration.paneId !== target.paneId) return false;
    if (target.surfaceKind !== undefined && registration.surfaceKind !== target.surfaceKind) return false;
    return true;
  }
  if (target?.surfaceKind !== undefined) return registration.surfaceKind === target.surfaceKind;
  return registration.paneId !== sourceId;
}

function timeoutOf(target?: PaneCommandTarget): number {
  const value = target?.timeoutMs;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  return DEFAULT_TIMEOUT_MS;
}

function invoke(registration: Registration, event: PaneBusEvent, timeoutMs: number): Promise<PaneCommandResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: PaneCommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ paneId: registration.paneId, error: "timed out" }), timeoutMs);
    Promise.resolve()
      .then(() => registration.handler(event))
      .then(
        (value) => finish({ paneId: registration.paneId, value }),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          finish({ paneId: registration.paneId, error: message });
        },
      );
  });
}
