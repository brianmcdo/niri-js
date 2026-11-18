import { expect, test } from "bun:test";
import { PaneBus } from "./bus.ts";

test("a listener hears the pane that sent the message", () => {
  const bus = new PaneBus();
  const heard: string[] = [];
  const stop = bus.on("ping", (event) => heard.push(`${event.sourceId}:${String(event.detail)}`));
  bus.emit("notes", "ping", "hello");
  bus.emit("notes", "other", "nope");
  stop();
  bus.emit("notes", "ping", "again");
  expect(heard).toEqual(["notes:hello"]);
});

test("a blank name is ignored", () => {
  const bus = new PaneBus();
  let calls = 0;
  bus.on("  ", () => {
    calls += 1;
  });
  bus.emit("notes", "   ", 1);
  expect(calls).toBe(0);
});
