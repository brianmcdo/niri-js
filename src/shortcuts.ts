export type ShortcutAction =
  | "focusLeft"
  | "focusRight"
  | "focusUp"
  | "focusDown"
  | "focusFirst"
  | "focusLast"
  | "moveLeft"
  | "moveRight"
  | "moveUp"
  | "moveDown"
  | "groupLeft"
  | "groupRight"
  | "groupUp"
  | "groupDown"
  | "splitRight"
  | "splitDown"
  | "splitUp"
  | "splitPlaneDown"
  | "splitPlaneUp"
  | "insertLeft"
  | "insertRight"
  | "removeBlankUp"
  | "removeBlankDown"
  | "selectGroup"
  | "home"
  | "overview"
  | "maximize";

interface Binding {
  key: string;
  alt: boolean;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
}

const bindings: Record<ShortcutAction, Binding[]> = {
  focusLeft: [mod("ArrowLeft"), mod("h")],
  focusRight: [mod("ArrowRight"), mod("l")],
  focusUp: [mod("ArrowUp"), mod("k")],
  focusDown: [mod("ArrowDown"), mod("j")],
  focusFirst: [mod("Home")],
  focusLast: [mod("End")],
  moveLeft: [mod("ArrowLeft", { ctrl: true }), mod("h", { ctrl: true })],
  moveRight: [mod("ArrowRight", { ctrl: true }), mod("l", { ctrl: true })],
  moveUp: [mod("ArrowUp", { ctrl: true }), mod("k", { ctrl: true })],
  moveDown: [mod("ArrowDown", { ctrl: true }), mod("j", { ctrl: true })],
  groupLeft: [mod("ArrowLeft", { ctrl: true, shift: true })],
  groupRight: [mod("ArrowRight", { ctrl: true, shift: true })],
  groupUp: [mod("ArrowUp", { ctrl: true, shift: true })],
  groupDown: [mod("ArrowDown", { ctrl: true, shift: true })],
  splitRight: [plain("Enter", { ctrl: true, shift: true })],
  splitDown: [plain("Enter", { alt: true, ctrl: true, shift: true })],
  splitUp: [mod("ArrowUp", { shift: true })],
  insertLeft: [mod("ArrowLeft", { shift: true })],
  insertRight: [mod("ArrowRight", { shift: true })],
  removeBlankUp: [mod("Home", { ctrl: true, shift: true })],
  removeBlankDown: [mod("End", { ctrl: true, shift: true })],
  selectGroup: [mod("g", { shift: true })],
  home: [mod("Home", { shift: true })],
  overview: [mod("o")],
  maximize: [mod("m")],
  splitPlaneDown: [plain("}", { ctrl: true, shift: true }), plain("]", { ctrl: true, shift: true })],
  splitPlaneUp: [plain("{", { ctrl: true, shift: true }), plain("[", { ctrl: true, shift: true })],
};

export interface ShortcutEvent {
  key: string;
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export function matchShortcut(event: ShortcutEvent): ShortcutAction | null {
  const keys = [event.key];
  if (event.altKey && /^Key[A-Z]$/.test(event.code)) keys.push(event.code.slice(3).toLowerCase());
  for (const [action, choices] of Object.entries(bindings) as [ShortcutAction, Binding[]][]) {
    for (const binding of choices) {
      if (
        binding.alt === event.altKey &&
        binding.ctrl === event.ctrlKey &&
        binding.meta === event.metaKey &&
        binding.shift === event.shiftKey &&
        keys.some((key) => keyMatches(binding.key, key))
      ) {
        return action;
      }
    }
  }
  return null;
}

export function shortcutLabel(action: ShortcutAction, apple: boolean): string {
  const binding = bindings[action][0];
  if (!binding) return "";
  const parts = [
    binding.ctrl ? (apple ? "⌃" : "Ctrl") : "",
    binding.alt ? (apple ? "⌥" : "Alt") : "",
    binding.shift ? (apple ? "⇧" : "Shift") : "",
    binding.meta ? (apple ? "⌘" : "Meta") : "",
    prettyKey(binding.key),
  ].filter(Boolean);
  return parts.join("+");
}

function mod(key: string, extra?: { ctrl?: boolean; shift?: boolean }): Binding {
  return plain(key, { alt: true, ctrl: extra?.ctrl, shift: extra?.shift });
}

function plain(
  key: string,
  extra?: { alt?: boolean; ctrl?: boolean; shift?: boolean; meta?: boolean },
): Binding {
  return {
    key,
    alt: extra?.alt ?? false,
    ctrl: extra?.ctrl ?? false,
    shift: extra?.shift ?? false,
    meta: extra?.meta ?? false,
  };
}

function keyMatches(expected: string, actual: string): boolean {
  if (expected.length === 1 && actual.length === 1) return expected.toLowerCase() === actual.toLowerCase();
  return expected === actual;
}

function prettyKey(key: string): string {
  const names: Record<string, string> = {
    ArrowLeft: "←",
    ArrowRight: "→",
    ArrowUp: "↑",
    ArrowDown: "↓",
  };
  return names[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}
