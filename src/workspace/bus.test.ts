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

test("a command reaches every pane of a surface kind", async () => {
  const bus = new PaneBus();
  bus.handle("ledger-a", "ledger", "rename", (event) => `a:${String(event.detail)}`);
  bus.handle("ledger-b", "ledger", "rename", (event) => `b:${String(event.detail)}`);
  bus.handle("clock", "clock", "rename", () => "clock");
  const results = await bus.command("notes", "rename", "draft", { surfaceKind: "ledger" });
  expect(results).toEqual([
    { paneId: "ledger-a", value: "a:draft" },
    { paneId: "ledger-b", value: "b:draft" },
  ]);
});

test("a pane id reaches that pane, including the sender", async () => {
  const bus = new PaneBus();
  bus.handle("notes", "editor", "ping", () => "self");
  bus.handle("other", "editor", "ping", () => "them");
  expect(await bus.command("notes", "ping", undefined, { paneId: "other" })).toEqual([{ paneId: "other", value: "them" }]);
  expect(await bus.command("notes", "ping", undefined, { paneId: "notes" })).toEqual([{ paneId: "notes", value: "self" }]);
  expect(await bus.command("notes", "ping", undefined, { paneId: "other", surfaceKind: "clock" })).toEqual([]);
  expect(await bus.command("notes", "ping", undefined, { paneId: "other", surfaceKind: "editor" })).toEqual([
    { paneId: "other", value: "them" },
  ]);
});

test("a broadcast command skips the sender", async () => {
  const bus = new PaneBus();
  bus.handle("notes", "editor", "ping", () => "self");
  bus.handle("other", "editor", "ping", () => "them");
  expect(await bus.command("notes", "ping")).toEqual([{ paneId: "other", value: "them" }]);
});

test("a thrown handler becomes an error result beside a successful one", async () => {
  const bus = new PaneBus();
  bus.handle("a", "ledger", "rename", () => {
    throw new Error("nope");
  });
  bus.handle("b", "ledger", "rename", () => "ok");
  const results = await bus.command("sender", "rename", undefined, { surfaceKind: "ledger" });
  expect(results).toEqual([
    { paneId: "a", error: "nope" },
    { paneId: "b", value: "ok" },
  ]);
});

test("a blank command name resolves to nothing", async () => {
  const bus = new PaneBus();
  bus.handle("notes", "editor", "   ", () => "nope");
  expect(await bus.command("other", "   ")).toEqual([]);
});

test("a command that never settles times out", async () => {
  const bus = new PaneBus();
  bus.handle("slow", "clock", "wait", () => new Promise(() => {}));
  const results = await bus.command("sender", "wait", undefined, { paneId: "slow", timeoutMs: 10 });
  expect(results).toEqual([{ paneId: "slow", error: "timed out" }]);
});

test("messages and commands stay on separate maps", async () => {
  const bus = new PaneBus();
  let messages = 0;
  bus.on("save", () => {
    messages += 1;
  });
  bus.handle("notes", "editor", "save", () => 1);
  bus.emit("other", "save");
  expect(await bus.command("other", "save")).toEqual([{ paneId: "notes", value: 1 }]);
  expect(messages).toBe(1);
});
