import type { PaneBusEvent } from "../types.ts";

type Listener = (event: PaneBusEvent) => void;

/** A tiny channel panes share. Listeners are keyed by message name. */
export class PaneBus {
  private readonly listeners = new Map<string, Set<Listener>>();

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

  clear(): void {
    this.listeners.clear();
  }
}
