import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
// The runner launches its own headless Chrome with a fresh temporary user-data-dir.
describe.skipIf(process.env.FIT_BROWSER !== "1")("small windows and settings in isolated Chrome", () => {
  it("fits every look/face, keeps actions reachable, and preserves modal settings behaviour", async () => {
    const { stdout } = await run(process.execPath, ["scripts/browser/fit.mjs"], { timeout: 180000, maxBuffer: 1024 * 1024 });
    expect(stdout).toContain("PASS:");
  }, 190000);
});
