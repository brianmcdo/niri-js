import { expect, test } from "bun:test";
import { matchShortcut, type ShortcutEvent } from "./shortcuts.ts";

function press(key: string, modifiers: Partial<ShortcutEvent> = {}): ShortcutEvent {
  return {
    key,
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...modifiers,
  };
}

test("alt arrows focus and ctrl+alt arrows move", () => {
  expect(matchShortcut(press("ArrowRight", { altKey: true }))).toBe("focusRight");
  expect(matchShortcut(press("l", { altKey: true }))).toBe("focusRight");
  expect(matchShortcut(press("ArrowLeft", { altKey: true, ctrlKey: true }))).toBe("moveLeft");
});

test("option on an apple keyboard still matches the letter shortcut", () => {
  expect(matchShortcut(press("ø", { code: "KeyO", altKey: true }))).toBe("overview");
});

test("typing in a shortcut does not match without the modifier", () => {
  expect(matchShortcut(press("o"))).toBeNull();
  expect(matchShortcut(press("Enter", { ctrlKey: true, shiftKey: true }))).toBe("splitRight");
});
