import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
// The runner launches its own headless Chrome with a fresh temporary user-data-dir.
describe.skipIf(process.env.BACKUP_BROWSER !== "1")("settings export and import in isolated Chrome", () => {
  it("uses the owner's timer and history when a stale follower imports across segments", async () => {
    const { stdout } = await run(process.execPath, ["scripts/browser/follower-import.mjs"], { timeout: 60000, maxBuffer: 1024 * 1024 });
    expect(stdout.match(/PASS: stale follower import/g)).toHaveLength(11);
  }, 65000);
  it("exports chosen sections, previews and applies only ticked sections in every look", async () => {
    const { stdout } = await run(process.execPath, ["scripts/browser/backup.mjs"], { timeout: 240000, maxBuffer: 4 * 1024 * 1024 });
    expect(stdout).toMatch(/pass/i);
  }, 250000);
});
