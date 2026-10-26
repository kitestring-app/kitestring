import { describe, expect, it, vi } from "vitest";
import { dayKey, sessionLog } from "../../state/stats";
import type { LoggedChunk, StatsData } from "../../state/stats";
import { csvCell, downloadFile, sessionLogCsv } from "./csv";
const at = new Date(2026, 9, 24, 10).getTime();
const chunk = (patch: Partial<LoggedChunk> = {}): LoggedChunk => ({ id: "a", kind: "focus", segment: "focus", start: at, ms: 60_000, completed: false, ...patch });
const data = (...chunks: LoggedChunk[]): StatsData => ({ chunks, tasksDone: [] });

describe("session log", () => {
  it("combines paused entries, excludes pauses from duration, and retains task changes", () => {
    const days = sessionLog(data(chunk({ segId: "s", taskId: "t" }), chunk({ id: "b", segId: "s", start: at + 180_000, ms: 120_000, completed: true, taskId: "u" })), [{ id: "t", title: "Write" }, { id: "u", title: "Read" }], {}, [{ segId: "s", at: at + 60_000 }, { segId: "other", at }]);
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ day: dayKey(at), focusMs: 180_000, breakMs: 0, interruptions: 1 });
    expect(days[0].sessions).toHaveLength(1);
    expect(days[0].sessions[0]).toMatchObject({ start: at, end: at + 300_000, ms: 180_000, completed: true, taskTitles: ["Write", "Read"], interruptions: 1 });
  });
  it("keeps legacy entries separate and includes short and long breaks with their own totals", () => {
    const days = sessionLog(data(chunk(), chunk({ id: "b", start: at + 60_000, kind: "break", segment: "short", completed: true }), chunk({ id: "c", start: at + 120_000, kind: "break", segment: "long", ms: 120_000 })), []);
    expect(days[0]).toMatchObject({ focusMs: 60_000, breakMs: 180_000, interruptions: 0 });
    expect(days[0].sessions.map(s => [s.segment, s.completed, s.taskTitles])).toEqual([["long", false, ["No task"]], ["short", true, ["No task"]], ["focus", false, ["No task"]]]);
  });
  it("filters inclusive local dates and task IDs, including deleted tasks and no task", () => {
    const next = new Date(2026, 9, 25).getTime();
    const history = data(chunk({ taskId: "deleted" }), chunk({ id: "b", start: next }), chunk({ id: "c", start: next, taskId: "t" }));
    expect(sessionLog(history, [], { from: dayKey(at), to: dayKey(at), taskId: "deleted" })[0].sessions[0].taskTitles).toEqual(["Deleted task"]);
    expect(sessionLog(history, [], { from: dayKey(next), to: dayKey(next), taskId: "" })[0].sessions).toHaveLength(1);
    expect(sessionLog(history, [], { from: "2026-10-26", to: "2026-10-24" })).toEqual([]);
    expect(sessionLog(history, [], { taskId: "missing" })).toEqual([]);
    expect(sessionLog(data(), [])).toEqual([]);
  });
  it("assigns a session spanning midnight to its first local day", () => {
    const late = new Date(2026, 9, 24, 23, 59).getTime();
    const days = sessionLog(data(chunk({ segId: "night", start: late }), chunk({ id: "b", segId: "night", start: late + 120_000, completed: true })), []);
    expect(days).toHaveLength(1);
    expect(days[0].day).toBe("2026-10-24");
    expect(days[0].focusMs).toBe(120_000);
  });
  it("does not collide a legacy entry ID with a segment ID", () => {
    expect(sessionLog(data(chunk({ id: "a" }), chunk({ id: "b", segId: "entry:a" })), [])[0].sessions).toHaveLength(2);
  });
});

describe("CSV export", () => {
  it("quotes commas, quotes, CR and LF using RFC 4180", () => {
    expect(csvCell('a,"b"\r\nc')).toBe('"a,""b""\r\nc"');
    const days = sessionLog(data(chunk({ taskId: "t", completed: true })), [{ id: "t", title: 'Write, "hello"\nnext' }]);
    const csv = sessionLogCsv(days);
    expect(csv).toContain('"Write, ""hello""\nnext"');
    expect(csv).toContain('"Completed","0"\r\n');
    expect(csv).toContain(new Date(at).toISOString());
    expect(csv).toContain('"60","Focus"');
    expect(sessionLogCsv([]).split("\r\n")).toHaveLength(2);
  });
  it.each(["=1+1", "+SUM(A1)", "-2+3", "@SUM(A1)", " \t=cmd()", "\r@formula"])("neutralizes spreadsheet formulas: %s", title => {
    expect(csvCell(title)).toBe(`"'${title}"`);
  });
  it.each([false, true])("uses a download link with delayed URL cleanup (desktop=%s)", desktop => {
    vi.useFakeTimers();
    const link = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal("window", desktop ? { desktop: {} } : {});
    vi.stubGlobal("document", { createElement: () => link, body: { append: vi.fn() } });
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    try {
      downloadFile(new Blob(["csv"]), "log.csv");
      expect(link.download).toBe("log.csv"); expect(link.click).toHaveBeenCalledOnce();
      expect(link.remove).toHaveBeenCalledOnce(); expect(revoke).not.toHaveBeenCalled();
      vi.advanceTimersByTime(60_000); expect(revoke).toHaveBeenCalledWith("blob:test");
    } finally { create.mockRestore(); revoke.mockRestore(); vi.unstubAllGlobals(); vi.useRealTimers(); }
  });
});
