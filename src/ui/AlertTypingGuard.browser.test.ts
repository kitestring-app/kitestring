import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
describe.skipIf(process.env.TYPING_GUARD_BROWSER !== "1")("alert keyboard quiet window in disposable Chrome", () => {
  it("protects alarms, reminders and recovery with and without the native bridge", async () => {
    const { stdout } = await run(process.execPath, ["scripts/browser/typing-guard.mjs"], { timeout: 90000, maxBuffer: 1024 * 1024 });
    expect(stdout).toContain("PASS:");
  }, 95000);
});
