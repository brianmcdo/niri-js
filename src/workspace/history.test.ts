import { expect, test } from "bun:test";
import { emptyTrail, forgetFocus, recordFocus, stepBack, stepForward } from "./history.ts";

test("moving to a new pane records the one that was left", () => {
  const trail = recordFocus(recordFocus(emptyTrail(), "guide", "clock"), "clock", "ledger");
  expect(trail).toEqual({ past: ["guide", "clock"], future: [] });
  expect(recordFocus(trail, "ledger", "ledger")).toEqual(trail);
});

test("back and forward walk the trail and skip a pane that is gone", () => {
  const trail = recordFocus(recordFocus(emptyTrail(), "guide", "clock"), "clock", "ledger");
  const back = stepBack(trail, "ledger", (id) => id !== "clock");
  expect(back.target).toBe("guide");
  expect(back.trail.future).toEqual(["ledger"]);
  const forward = stepForward(back.trail, "guide", () => true);
  expect(forward.target).toBe("ledger");
  expect(forward.trail.past).toEqual(["guide"]);
});

test("forgetting a pane removes it from both directions", () => {
  const trail = forgetFocus({ past: ["guide", "clock"], future: ["clock", "notes"] }, "clock");
  expect(trail).toEqual({ past: ["guide"], future: ["notes"] });
});
