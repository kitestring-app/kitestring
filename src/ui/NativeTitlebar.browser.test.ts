import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
describe.skipIf(process.env.TITLEBAR_BROWSER !== "1")("Mac title bar in disposable Chrome", () => {
  it("reserves native chrome only for the Mac main window and fits every look", async () => {
    const { stdout } = await run(process.execPath, ["scripts/browser/titlebar.mjs"], { timeout: 180000, maxBuffer: 1024 * 1024 });
    expect(stdout).toContain("PASS:");
  }, 190000);
});
