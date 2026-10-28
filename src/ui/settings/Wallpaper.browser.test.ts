import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
const run = promisify(execFile);
describe.skipIf(process.env.WALLPAPER_BROWSER !== "1")("wallpapers in disposable muted Chrome", () => {
  it("picks and restores wallpapers in every look, with readable paper ink and phone fit", async () => {
    const { stdout } = await run(process.execPath, ["scripts/browser/wallpaper.mjs"], { timeout: 180000, maxBuffer: 1024 * 1024 });
    expect(stdout).toContain("PASS:");
  }, 190000);
});
