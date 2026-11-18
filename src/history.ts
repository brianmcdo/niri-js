export interface FocusTrail {
  past: string[];
  future: string[];
}

const LIMIT = 50;

export function emptyTrail(): FocusTrail {
  return { past: [], future: [] };
}

/** Remember the pane that was left. A jump that stays put does not grow the trail. */
export function recordFocus(trail: FocusTrail, from: string | null, to: string | null): FocusTrail {
  if (!from || from === to) return trail;
  return { past: [...trail.past, from].slice(-LIMIT), future: [] };
}

export function forgetFocus(trail: FocusTrail, paneId: string): FocusTrail {
  return {
    past: trail.past.filter((id) => id !== paneId),
    future: trail.future.filter((id) => id !== paneId),
  };
}

export function stepBack(
  trail: FocusTrail,
  current: string | null,
  alive: (id: string) => boolean,
): { trail: FocusTrail; target: string | null } {
  return step(trail, current, alive, "past");
}

export function stepForward(
  trail: FocusTrail,
  current: string | null,
  alive: (id: string) => boolean,
): { trail: FocusTrail; target: string | null } {
  return step(trail, current, alive, "future");
}

function step(
  trail: FocusTrail,
  current: string | null,
  alive: (id: string) => boolean,
  from: "past" | "future",
): { trail: FocusTrail; target: string | null } {
  const source = [...trail[from]];
  const other = [...(from === "past" ? trail.future : trail.past)];
  let target: string | null = null;
  while (source.length > 0) {
    const id = source.pop();
    if (id && alive(id)) {
      target = id;
      break;
    }
  }
  if (!target) {
    return from === "past" ? { trail: { past: source, future: trail.future }, target: null } : { trail: { past: trail.past, future: source }, target: null };
  }
  if (current) other.push(current);
  const kept = other.slice(-LIMIT);
  return from === "past"
    ? { trail: { past: source, future: kept }, target }
    : { trail: { past: kept, future: source }, target };
}
