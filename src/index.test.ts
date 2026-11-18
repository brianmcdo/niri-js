import { expect, test } from "bun:test";
import { TapeWorkspace } from "./index.ts";

test("the package entry exports the workspace", () => {
  expect(TapeWorkspace.prototype.openPane).toBeFunction();
  expect(TapeWorkspace.prototype.destroy).toBeFunction();
});
