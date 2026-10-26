import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
const alertFiles = createRequire(import.meta.url)("../../desktop/alert-files.cjs") as {
  alertFile: (sound: unknown, kind: unknown) => string | null;
  validAlertSound: (sound: unknown) => boolean;
};

// Exercise the companion's actual alarm functions without starting a server or making native sounds.
function alarmFunctions(deferPlayback = false) {
  const source = readFileSync(new URL("../../scripts/companion.mjs", import.meta.url), "utf8");
  const playback: (() => void)[] = [];
  const kill = vi.fn();
  const execFile = vi.fn((path: string, _args: string[], done: () => void) => {
    if (path === "/usr/bin/afplay" && deferPlayback) playback.push(done);
    else if (path !== "/usr/bin/say") done();
    return { kill };
  });
  let handler: (req: unknown, res: unknown) => Promise<void>;
  const sandbox = {
    ...alertFiles, VERSION: 1, Buffer, URL, HOST: "127.0.0.1",
    createServer: (callback: typeof handler) => { handler = callback; return {}; },
    execFile, join, root: "/unused", PORT: 4747, stateFile: "/unused/alarm.json", log: vi.fn(),
    readFileSync: () => { throw new Error("No saved alarm"); }, writeFileSync: vi.fn(),
    setTimeout, clearTimeout, Date,
    api: null as null | { ring: (a: unknown) => void; valid: (a: unknown) => boolean; cancelSpeech: () => void },
  };
  runInNewContext(source.slice(source.indexOf("const TEXT ="), source.indexOf("\nserver.listen(")) + "\nglobalThis.api = { ring, valid, cancelSpeech };", sandbox);
  async function post(route: string, body: unknown, method = "POST") {
    let status = 0;
    let response: unknown;
    const req = {
      url: route, method, headers: { host: "localhost:4747", origin: "http://localhost:4747", "x-custom-pomodoro": "1" },
      async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); },
    };
    await handler(req, { writeHead(code: number) { status = code; }, end(body: string) { response = JSON.parse(body); } });
    return { status, response };
  }
  return { ...sandbox.api!, execFile, playback, kill, post, writes: sandbox.writeFileSync };

}

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("native spoken line", () => {
  it("validates the sound enum, including inherited-property and path attacks", () => {
    const { valid } = alarmFunctions();
    const base = { at: Date.now() + 60_000, kind: "focus-done", volume: 0.5, speak: true };
    for (const alertSound of ["signature", "bell", "chime", "digital", "wood", "none", undefined]) expect(valid({ ...base, alertSound })).toBe(true);
    for (const alertSound of ["../bell", "/tmp/bell.wav", "constructor", "__proto__", "", null, {}, 1]) expect(valid({ ...base, alertSound })).toBe(false);
  });
  it.each(["signature", "bell", "chime", "digital", "wood"])("plays %s once for each phase at the preview volume", (alertSound) => {
    const { ring, execFile } = alarmFunctions();
    for (const kind of ["focus-done", "break-over"]) {
      execFile.mockClear();
      ring({ kind, alertSound, volume: 0.3, speak: false });
      expect(execFile.mock.calls.filter(([file]) => file === "/usr/bin/afplay")).toEqual([
        ["/usr/bin/afplay", ["-v", "0.3", join("/unused", "alerts", `${alertSound}-${kind}.wav`)], expect.any(Function)],
      ]);
    }
  });
  it("none keeps native notification and speech at nonzero volume", () => {
    const { ring, execFile } = alarmFunctions();
    ring({ kind: "break-over", alertSound: "none", volume: 1, speak: true });
    expect(execFile.mock.calls.map(([file]) => file)).toEqual(["/opt/homebrew/bin/terminal-notifier", "/usr/bin/say"]);
  });
  it("stores the posted selection and validates test requests without replacing the pending alarm", async () => {
    vi.useFakeTimers();
    const { post, writes, execFile } = alarmFunctions();
    const alarm = { at: Date.now() + 60_000, kind: "break-over", volume: 0.4, speak: false, alertSound: "wood" };
    expect((await post("/api/alarm", alarm)).status).toBe(200);
    expect(JSON.parse(writes.mock.calls.at(-1)![1])).toEqual(alarm);
    const saves = writes.mock.calls.length;
    expect((await post("/api/test", { kind: "break-over", volume: 0.4, alertSound: "digital" })).status).toBe(200);
    expect(execFile.mock.calls.find(([file]) => file === "/usr/bin/afplay")?.[1]).toEqual(["-v", "0.4", join("/unused", "alerts", "digital-break-over.wav")]);
    expect(writes).toHaveBeenCalledTimes(saves);
    execFile.mockClear();
    for (const route of ["/api/test", "/api/alarm"]) {
      expect((await post(route, { ...alarm, alertSound: "../../evil" })).status).toBe(400);
      expect((await post(route, { ...alarm, kind: "../../evil" })).status).toBe(400);
    }
    expect(execFile).not.toHaveBeenCalled();
    expect(writes).toHaveBeenCalledTimes(saves);
  });
  it("validates the speech boolean", () => {
    const { valid } = alarmFunctions();
    const alarm = { at: Date.now() + 60_000, kind: "break-over", volume: 0.7 };
    expect(valid({ ...alarm, speak: true })).toBe(true);
    expect(valid({ ...alarm, speak: false })).toBe(true);
    for (const speak of [undefined, "yes", 1, null, {}]) expect(valid({ ...alarm, speak })).toBe(false);
  });
  it.each(["focus-done", "break-over"])("speaks fixed %s text after the selected afplay call", (kind) => {
    const { ring, execFile } = alarmFunctions();
    ring({ kind, volume: 0.8, speak: true, spoken: "User-controlled text must never be spoken" });
    const calls = execFile.mock.calls;
    expect(calls.map(([path]) => path)).toEqual(["/opt/homebrew/bin/terminal-notifier", "/usr/bin/afplay", "/usr/bin/say"]);
    expect(calls.at(-1)?.[1]).toEqual([kind === "focus-done" ? "Focus session done. Time for a break." : "Break is over. Time to focus."]);
  });
  it("does not speak when disabled and supports speech with no chime", () => {
    const { ring, execFile } = alarmFunctions();
    ring({ kind: "focus-done", volume: 0.8, speak: false });
    expect(execFile.mock.calls.some(([path]) => path === "/usr/bin/say")).toBe(false);
    execFile.mockClear();
    ring({ kind: "break-over", volume: 0, speak: true });
    expect(execFile.mock.calls.map(([path]) => path)).toEqual(["/opt/homebrew/bin/terminal-notifier", "/usr/bin/say"]);
  });
  it("cancels speech while afplay is still running or while say is speaking", () => {
    const pending = alarmFunctions(true);
    pending.ring({ kind: "focus-done", volume: 0.8, speak: true });
    pending.cancelSpeech();
    pending.playback.shift()!();
    expect(pending.execFile.mock.calls.some(([path]) => path === "/usr/bin/say")).toBe(false);
    const active = alarmFunctions();
    active.ring({ kind: "focus-done", volume: 0, speak: true });
    active.cancelSpeech();
    expect(active.kill).toHaveBeenCalledOnce();
  });
});

it("DELETE alarm stops current companion playback, queued speech and re-arming", async () => {
  const h = alarmFunctions(true);
  h.ring({ kind: "focus-done", volume: 0.8, speak: true });
  expect((await h.post("/api/alarm", null, "DELETE")).status).toBe(200);
  expect(h.kill).toHaveBeenCalledOnce();
  h.playback.shift()!();
  expect(h.execFile.mock.calls.some(([file]) => file === "/usr/bin/say")).toBe(false);
  expect((await h.post("/api/alarm", null, "DELETE")).status).toBe(200);
  expect(h.kill).toHaveBeenCalledOnce();
});
