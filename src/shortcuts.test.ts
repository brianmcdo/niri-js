import { expect, test } from "bun:test";
import { matchShortcut, shortcutLabel, type ShortcutAction, type ShortcutEvent } from "./shortcuts.ts";

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
  expect(matchShortcut(press("o", { metaKey: true }))).toBeNull();
});

test("the remaining bindings map to one action each", () => {
  const cases: [ShortcutEvent, ShortcutAction][] = [
    [press("ArrowLeft", { altKey: true }), "focusLeft"],
    [press("k", { altKey: true }), "focusUp"],
    [press("j", { altKey: true }), "focusDown"],
    [press("Home", { altKey: true }), "focusFirst"],
    [press("End", { altKey: true }), "focusLast"],
    [press("ArrowRight", { altKey: true, ctrlKey: true }), "moveRight"],
    [press("ArrowUp", { altKey: true, ctrlKey: true }), "moveUp"],
    [press("ArrowDown", { altKey: true, ctrlKey: true }), "moveDown"],
    [press("ArrowRight", { altKey: true, ctrlKey: true, shiftKey: true }), "groupRight"],
    [press("ArrowDown", { altKey: true, ctrlKey: true, shiftKey: true }), "groupDown"],
    [press("Enter", { altKey: true, ctrlKey: true, shiftKey: true }), "splitDown"],
    [press("ArrowUp", { altKey: true, shiftKey: true }), "splitUp"],
    [press("ArrowLeft", { altKey: true, shiftKey: true }), "insertLeft"],
    [press("ArrowRight", { altKey: true, shiftKey: true }), "insertRight"],
    [press("Home", { altKey: true, ctrlKey: true, shiftKey: true }), "removeBlankUp"],
    [press("End", { altKey: true, ctrlKey: true, shiftKey: true }), "removeBlankDown"],
    [press("g", { altKey: true, shiftKey: true }), "selectGroup"],
    [press("g", { altKey: true }), "editGroup"],
    [press("]", { altKey: true }), "groupNext"],
    [press("‘", { code: "BracketLeft", altKey: true }), "groupPrev"],
    [press("Home", { altKey: true, shiftKey: true }), "home"],
    [press("m", { altKey: true }), "maximize"],
    [press("}", { ctrlKey: true, shiftKey: true }), "splitPlaneDown"],
    [press("[", { ctrlKey: true, shiftKey: true }), "splitPlaneUp"],
  ];
  for (const [event, action] of cases) expect(matchShortcut(event)).toBe(action);
});

test("command-k and control-k open spotlight", () => {
  expect(matchShortcut(press("k", { metaKey: true }))).toBe("spotlight");
  expect(matchShortcut(press("k", { ctrlKey: true }))).toBe("spotlight");
  expect(matchShortcut(press("k", { metaKey: true, shiftKey: true }))).toBeNull();
});

test("labels use the platform modifier and a plus between keys", () => {
  expect(shortcutLabel("overview", true)).toBe("⌥+O");
  expect(shortcutLabel("overview", false)).toBe("Alt+O");
  expect(shortcutLabel("splitRight", false)).toBe("Ctrl+Shift+Enter");
  expect(shortcutLabel("focusLeft", true)).toBe("⌥+←");
  expect(shortcutLabel("groupRight", false)).toBe("Ctrl+Alt+Shift+→");
  expect(shortcutLabel("spotlight", true)).toBe("⌘+K");
  expect(shortcutLabel("spotlight", false)).toBe("Ctrl+K");
});
