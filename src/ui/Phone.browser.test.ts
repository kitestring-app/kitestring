import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
describe.skipIf(process.env.PHONE_BROWSER !== "1")("phone web layout in disposable Chrome", () => {
  it("fits every phone and look, with reachable sheets, settings and touch controls", async () => {
    const { stdout } = await run(process.execPath, ["scripts/browser/phone.mjs"], { timeout: 400000, maxBuffer: 1024 * 1024 });
    expect(stdout).toContain("PASS:");
  }, 410000);
});
