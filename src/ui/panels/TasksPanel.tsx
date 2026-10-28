import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { useStore } from "../../lib/store";
import {
  TASK_COLORS, editTaskOrder, addSubtask, childrenOf, clearDone, currentTask, deleteTask,
  duplicateTask, etaOf, focusPick, insertTaskAfter, remainingMinutes,
  tasks, toggleTaskGroup, topLevel, updateTask,
} from "../../state/tasks";
import type { Task } from "../../state/tasks";
import { stats } from "../../state/stats";
import { activeMinutes, recordedTaskMs, similarTasks } from "../../state/estimates";
import { settings } from "../../state/settings";
import type { Settings } from "../../state/settings";
import { useTimerView } from "../../state/timer";
import { Icon } from "../icons";
import "./TasksPanel.css";
import { Glyph, glyphFor, type GlyphName } from "../Glyph";

const TASK_ICONS: GlyphName[] = ["target", "library", "laptop", "pen-line", "notebook-pen", "brain", "palette", "lightbulb", "rocket", "star", "sprout", "flower-2", "sun", "moon", "flame", "dumbbell", "footprints", "sparkles", "music", "headphones", "coffee", "leaf", "apple", "salad", "house", "brush", "shopping-cart", "phone", "mail", "calendar", "chart-column", "flask-conical", "microscope", "wrench", "package", "wallet", "clapperboard", "cat", "globe", "circle-check"];
const ESTIMATES = [5, 10, 15, 20, 25, 30, 45, 60, 90, 120, 180, 240];
const COLOR_NAMES = ["Lavender", "Pink", "Green", "Blue", "Yellow", "Coral", "Teal"];
const openFirst = (rows: Task[]) => [...rows.filter((t) => !t.done), ...rows.filter((t) => t.done)];

/** Persist the same open-first, parent/children order the panel displays. */
export function visualTaskOrder(all: Task[]): Task[] {
  const ordered = openFirst(topLevel(all)).flatMap((t) => [t, ...openFirst(childrenOf(all, t.id))]);
  const ids = new Set(ordered.map((t) => t.id));
  return [...ordered, ...all.filter((t) => !ids.has(t.id))];
}

/** Completed rows stay below open rows; children never cross parent boundaries. */
export function reorderTask(all: Task[], id: string, targetId: string, after = false): Task[] {
  const source = all.find((t) => t.id === id), target = all.find((t) => t.id === targetId);
  if (!source || !target || id === targetId || source.parentId !== target.parentId || source.done !== target.done) return all;
  const ordered = visualTaskOrder(all);
  const group = ordered.filter((t) => t.id === id || (!source.parentId && t.parentId === id));
  const rest = ordered.filter((t) => !group.includes(t));
  let index = rest.findIndex((t) => t.id === targetId);
  if (after) {
    index++;
    if (!target.parentId) while (rest[index]?.parentId === targetId) index++;
  }
  return [...rest.slice(0, index), ...group, ...rest.slice(index)];
}

export function safeTaskColor(color: unknown): string {
  return typeof color === "string" && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(color) ? color : "var(--fg-faint)";
}

/** Estimate continuous work, including scheduled breaks between sessions, never after the final task. */
export function estimateTaskFinish(all: Task[], pick: string | null, config: Settings["timer"],
  view: Pick<ReturnType<typeof useTimerView>, "state" | "elapsed" | "running" | "total">) {
  const active = currentTask(all, pick);
  const worked = view.running && view.state.segment === "focus" ? Math.max(0, view.elapsed / 60_000) : 0;
  const focusMinutes = Math.max(0, remainingMinutes(all) - Math.min(worked, active ? etaOf(all, active) : 0));
  let breakMinutes = 0;
  if (focusMinutes && config.mode !== "countdown" && config.mode !== "stopwatch") {
    const length = Math.max(1, config.mode === "5217" ? 52 : config.lengths.pomodoro);
    const inFocus = view.state.segment === "focus";
    const segmentLength = view.total === null ? length : view.total / 60_000;
    const first = inFocus ? Math.max(0, segmentLength - worked) : length;
    const breaks = Math.max(0, Math.ceil((focusMinutes - first) / length));
    if (!inFocus) breakMinutes += Math.max(0, segmentLength - (view.running ? view.elapsed / 60_000 : 0));
    if (config.mode === "5217") breakMinutes += breaks * 17;
    else if (config.mode === "animedoro") breakMinutes += breaks * config.lengths.long;
    else {
      const every = Math.max(1, config.longEvery);
      const round = view.state.segment === "long" ? 0 : view.state.round;
      const longs = Math.floor((round + breaks) / every) - Math.floor(round / every);
      breakMinutes += longs * config.lengths.long + (breaks - longs) * config.lengths.short;
    }
  }
  return { focusMinutes, breakMinutes, totalMinutes: focusMinutes + breakMinutes };
}

type Picker = "emoji" | "color" | "eta" | "actions";

function TaskPopover({ anchor, label, onClose, children }: {
  anchor: RefObject<HTMLButtonElement | null>; label: string; onClose: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    const button = anchor.current, popup = ref.current;
    if (!button || !popup) return;
    const place = () => {
      const box = button.getBoundingClientRect();
      const { width, height } = popup.getBoundingClientRect();
      setPosition({
        left: Math.max(8, Math.min(box.right - width, window.innerWidth - width - 8)),
        top: box.bottom + height + 8 < window.innerHeight ? box.bottom + 6 : Math.max(8, box.top - height - 6),
      });
    };
    place();
    const resize = new ResizeObserver(place);
    resize.observe(popup);
    popup.querySelector<HTMLElement>("button:not(:disabled), input")?.focus();
    return () => resize.disconnect();
  }, [anchor]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target) && !anchor.current?.contains(event.target)) onClose();
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); onClose(); anchor.current?.focus();
      }
    };
    const closeOnScroll = (event: Event) => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return;
      onClose();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", onClose);
    document.addEventListener("scroll", closeOnScroll, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", onClose);
      document.removeEventListener("scroll", closeOnScroll, true);
    };
  }, [anchor, onClose]);
  return createPortal(
    <div ref={ref} role="dialog" aria-label={label} className="tasks-popover" style={position}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Tab") {
          const controls = [...e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input, summary")];
          const edge = e.shiftKey ? controls[0] : controls.at(-1);
          if (!controls.length || document.activeElement === edge) {
            e.preventDefault();
            (e.shiftKey ? controls.at(-1) : controls[0])?.focus();
          }
        }
      }}>
      {children}
    </div>, document.body,
  );
}

function EtaPicker({ task, all, onClose }: { task: Task; all: Task[]; onClose: () => void }) {
  const [custom, setCustom] = useState(String(task.etaMin ?? 25));
  const choose = (minutes: number | undefined) => { updateTask(task.id, { etaMin: minutes }); onClose(); };
  return <>
    <span className="tasks-popover-label">Optional guess in minutes</span>
    <div className="tasks-estimates">
      {ESTIMATES.map((minutes) => <button key={minutes} aria-pressed={task.etaMin === minutes} onClick={() => choose(minutes)}>{minutes}</button>)}
    </div>
    <form className="tasks-custom-eta" onSubmit={(e) => {
      e.preventDefault();
      const value = Number(custom);
      if (Number.isInteger(value) && value >= 5 && value <= 240) choose(value);
    }}>
      <input className="input" aria-label="Custom estimate in minutes" type="number" min="5" max="240" step="1" required value={custom} onChange={(e) => setCustom(e.target.value)} />
      <button className="btn small" type="submit">Set</button>
    </form>
    <button className="tasks-menu-item" onClick={() => choose(undefined)}>Remove estimate</button>
    <EstimateHistory task={task} all={all} />
  </>;
}

function EstimateHistory({ task, all, completed = false }: { task: Task; all: Task[]; completed?: boolean }) {
  const data = useStore(stats);
  const similar = similarTasks(task, all, data);
  const comparison = (item: Task) => {
    const ms = recordedTaskMs(item, all, data);
    return <>{item.etaMin === undefined ? "No guess" : `Guess: about ${item.etaMin} min`} · {ms > 0 ? `Recorded active time: ${activeMinutes(ms)}` : "No active time recorded"}</>;
  };
  return <div className="task-comparison">
    {completed && <p>{comparison(task)}</p>}
    {similar.length > 0 && <details>
      <summary>Similar completed tasks</summary>
      <p className="faint">Matched by title. Recorded time shows timer use.</p>
      <ul>{similar.map(item => <li key={item.id}><span>{item.title}</span><br />{comparison(item)}</li>)}</ul>
    </details>}
  </div>;
}

function TaskRow({ task, all, isCurrent, collapsed, onCollapse, onCreate, onToggle, onDelete, onNavigate, onDrag, dragTarget }: {
  task: Task; all: Task[]; isCurrent: boolean; collapsed: boolean; onCollapse: () => void;
  onCreate: (id?: string) => void; onToggle: (id: string) => void; onDelete: (id: string) => void;
  onNavigate: (id: string, direction: -1 | 1) => void;
  onDrag: (event: ReactPointerEvent<HTMLButtonElement>, id: string) => void; dragTarget: boolean;
}) {
  const [picker, setPicker] = useState<Picker | null>(null);
  const emojiRef = useRef<HTMLButtonElement>(null), colorRef = useRef<HTMLButtonElement>(null);
  const etaRef = useRef<HTMLButtonElement>(null), actionsRef = useRef<HTMLButtonElement>(null);
  const kids = childrenOf(all, task.id);
  const siblings = openFirst(all.filter((t) => t.parentId === task.parentId && t.done === task.done));
  const index = siblings.findIndex((t) => t.id === task.id);
  const explicitPick = useStore(focusPick);
  const picked = explicitPick === task.id || isCurrent;
  const pick = () => focusPick.set((previous) => previous === task.id || isCurrent ? null : task.id);
  const move = (direction: -1 | 1) => {
    const other = siblings[index + direction];
    if (other) editTaskOrder((rows) => reorderTask(rows, task.id, other.id, direction === 1));
  };
  const title = task.title || "Untitled task";
  const close = () => setPicker(null);
  const act = (action: () => void) => { close(); actionsRef.current?.focus(); action(); };
  const keyDown = (e: KeyboardEvent<HTMLLIElement>) => {
    if (e.nativeEvent.isComposing) return;
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault(); e.stopPropagation(); onToggle(task.id);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault(); e.stopPropagation(); onNavigate(task.id, e.key === "ArrowUp" ? -1 : 1);
    } else if (e.target instanceof HTMLInputElement && e.target.type === "text") {
      if (e.key === "Enter") { e.preventDefault(); onCreate(insertTaskAfter(task.id)); }
      if (e.key === "Backspace" && !task.title) { e.preventDefault(); onDelete(task.id); }
    }
  };
  return <li data-task-id={task.id} className={`task-row${task.done ? " is-done" : ""}${task.parentId ? " is-child" : ""}${dragTarget ? " is-drag-target" : ""}`} onKeyDown={keyDown}>
    <div className="task-main">
      <button className="task-drag" aria-label={`Drag to reorder ${title}`} onPointerDown={(e) => onDrag(e, task.id)}>⠿</button>
      <input className="task-check" type="checkbox" checked={task.done} onChange={() => onToggle(task.id)} aria-label={title} />
      <button ref={emojiRef} className="task-emoji" aria-label={`Choose icon for ${title}`} aria-expanded={picker === "emoji"} aria-haspopup="dialog" onClick={() => setPicker(picker === "emoji" ? null : "emoji")}>{glyphFor(task.emoji) ? <Glyph name={glyphFor(task.emoji)!} size={18} /> : <Glyph name="circle" size={18} className="faint" />}</button>
      <input className="task-title" data-task-title={task.id} type="text" aria-label={`Task title: ${title}`} placeholder="Type your priority" value={task.title} onChange={(e) => updateTask(task.id, { title: e.target.value })} />
      <button className={isCurrent ? "task-now" : "task-focus"} disabled={task.done} aria-pressed={isCurrent} aria-label={`Focus on ${title}`} onClick={pick}>{isCurrent ? "Now" : "◎"}</button>
      <button ref={colorRef} className="task-color" aria-label={`Choose colour for ${title}`} aria-expanded={picker === "color"} aria-haspopup="dialog" onClick={() => setPicker(picker === "color" ? null : "color")}><span style={{ background: safeTaskColor(task.color) }} /></button>
      {kids.length ? <span className="task-eta" aria-label={`${etaOf(all, task)} minutes remaining across subtasks`}>{etaOf(all, task)}m</span> :
        <button ref={etaRef} className="task-eta" aria-label={`Estimate for ${title}`} aria-expanded={picker === "eta"} aria-haspopup="dialog" onClick={() => setPicker(picker === "eta" ? null : "eta")}>{task.etaMin ? `${task.etaMin}m` : "+ ETA"}</button>}
      <button ref={actionsRef} className="task-more" aria-label={`Actions for ${title}`} aria-expanded={picker === "actions"} aria-haspopup="dialog" onClick={() => setPicker(picker === "actions" ? null : "actions")}><Icon.more /></button>
    </div>
    {task.done && <EstimateHistory task={task} all={all} completed />}
    {kids.length > 0 && <button className="task-collapse" aria-expanded={!collapsed} aria-controls={`task-children-${task.id}`} onClick={onCollapse}>
      <span aria-hidden="true">{collapsed ? "▸" : "▾"}</span> {kids.filter((t) => t.done).length}/{kids.length} subtasks
    </button>}
    {picker && <TaskPopover anchor={{ emoji: emojiRef, color: colorRef, eta: etaRef, actions: actionsRef }[picker]} label={`${picker === "actions" ? "Task actions" : `Choose ${picker}`} for ${title}`} onClose={close}>
      {picker === "emoji" && <><div className="tasks-emojis">{TASK_ICONS.map((icon) => <button key={icon} aria-label={`Use ${icon.replace(/-/g, " ")} icon`} aria-pressed={glyphFor(task.emoji) === icon} onClick={() => { updateTask(task.id, { emoji: icon }); close(); emojiRef.current?.focus(); }}><Glyph name={icon} size={18} /></button>)}</div><button className="tasks-menu-item" onClick={() => { updateTask(task.id, { emoji: undefined }); close(); emojiRef.current?.focus(); }}>Remove icon</button></>}
      {picker === "color" && <><span className="tasks-popover-label">Colour tag</span><div className="tasks-colors">{TASK_COLORS.map((color, i) => <button key={color} style={{ background: color }} aria-label={`Use ${COLOR_NAMES[i]} colour tag`} aria-pressed={task.color === color} onClick={() => { updateTask(task.id, { color }); close(); colorRef.current?.focus(); }}>{task.color === color && <Icon.check />}</button>)}</div><button className="tasks-menu-item" onClick={() => { updateTask(task.id, { color: undefined }); close(); colorRef.current?.focus(); }}>Remove colour</button></>}
      {picker === "eta" && <EtaPicker task={task} all={all} onClose={() => { close(); etaRef.current?.focus(); }} />}
      {picker === "actions" && <div className="tasks-actions">
        <button className="tasks-menu-item" disabled={task.done} onClick={() => act(pick)}>{picked ? "Clear focus selection" : "Focus on this"}</button>
        <button className="tasks-menu-item" onClick={() => act(() => onCreate(addSubtask(task.id)))}><Icon.plus />Add subtask</button>
        <button className="tasks-menu-item" onClick={() => act(() => duplicateTask(task.id))}><Icon.copy />Duplicate</button>
        <button className="tasks-menu-item" disabled={index === 0} onClick={() => act(() => move(-1))}><Icon.up />Move up</button>
        <button className="tasks-menu-item" disabled={index === siblings.length - 1} onClick={() => act(() => move(1))}><Icon.down />Move down</button>
        <button className="tasks-menu-item task-delete" onClick={() => act(() => onDelete(task.id))}><Icon.trash />Delete</button>
      </div>}
    </TaskPopover>}
  </li>;
}

function Confetti({ burst }: { burst: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduceMotion = useStore(settings, (s) => s.extras.reduceMotion);
  useEffect(() => {
    if (!burst || reduceMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("reduce-motion")) return;
    const canvas = canvasRef.current, ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const w = window.innerWidth, h = window.innerHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = w * dpr; canvas.height = h * dpr; ctx.scale(dpr, dpr);
    const bits = Array.from({ length: 64 }, (_, i) => ({ x: Math.min(260, w / 2), y: h - 120, vx: (Math.random() - 0.5) * 440, vy: -260 - Math.random() * 420, spin: Math.random() * 10, color: TASK_COLORS[i % TASK_COLORS.length] }));
    let frame = 0;
    const start = performance.now();
    const draw = (now: number) => {
      const t = (now - start) / 1000;
      ctx.clearRect(0, 0, w, h);
      if (t >= 1.2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("reduce-motion")) return;
      ctx.globalAlpha = Math.min(1, (1.2 - t) * 3);
      for (const bit of bits) {
        ctx.save(); ctx.translate(bit.x + bit.vx * t, bit.y + bit.vy * t + 400 * t * t); ctx.rotate(bit.spin * t);
        ctx.fillStyle = bit.color; ctx.fillRect(-3, -4, 6, 8); ctx.restore();
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); ctx.clearRect(0, 0, w, h); };
  }, [burst, reduceMotion]);
  return createPortal(<canvas className="tasks-confetti" ref={canvasRef} aria-hidden="true" />, document.body);
}

function TaskSummary({ all }: { all: Task[] }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(timer); }, []);
  const view = useTimerView();
  const config = useStore(settings, (s) => s.timer);
  const pick = useStore(focusPick);
  const estimate = estimateTaskFinish(all, pick, config, view);
  const remaining = Math.ceil(estimate.focusMinutes);
  const finish = new Date(now + estimate.totalMinutes * 60_000);
  const date = new Date(now);
  const nextDay = finish.toDateString() !== date.toDateString();
  const done = all.filter((t) => t.done).length;
  return <div className="tasks-summary">
    {config.display !== "hidden" && <><div className="tasks-summary-line"><span><strong>{remaining < 60 ? `${remaining} min` : `${Math.floor(remaining / 60)}h${remaining % 60 ? ` ${remaining % 60}m` : ""}`}</strong> remaining</span>
      <span>Done by {nextDay ? `${finish.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ` : ""}{finish.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true })}</span></div>
    <p className="tasks-estimate-note">Estimate uses task ETAs, current focus progress and {Math.ceil(estimate.breakMinutes)} min of scheduled breaks between sessions. Assumes continuous work.</p></>}
    {all.length > 0 && <div className="tasks-progress" role="progressbar" aria-label="Task progress" aria-valuemin={0} aria-valuemax={all.length} aria-valuenow={done}><span style={{ width: `${done / all.length * 100}%` }} /></div>}
  </div>;
}

export function TasksPanel({ onClose }: { onClose: () => void }) {
  const all = useStore(tasks);
  const selected = useStore(focusPick);
  const active = currentTask(all, selected);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const focusTarget = useRef<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const [burst, setBurst] = useState(0);
  const panelRef = useRef<HTMLElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const dragCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanup.current?.(), []);
  const drag = (event: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    dragCleanup.current?.();
    const handle = event.currentTarget;
    const pointerId = event.pointerId, startX = event.clientX, startY = event.clientY;
    let targetId: string | null = null, after = false;
    handle.setPointerCapture(pointerId);
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < 5) { targetId = null; setDragTarget(null); return; }
      const row = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-task-id]");
      const rows = tasks.get(), source = rows.find((t) => t.id === id);
      let target = rows.find((t) => t.id === row?.dataset.taskId);
      if (source && !source.parentId && target?.parentId) target = rows.find((t) => t.id === target!.parentId);
      targetId = source && target && source.parentId === target.parentId && source.done === target.done && target.id !== id ? target.id : null;
      after = !!row && (row.dataset.taskId !== target?.id || e.clientY > row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2);
      setDragTarget(targetId);
    };
    const cleanup = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", cancel);
      handle.removeEventListener("lostpointercapture", cancel);
      document.removeEventListener("keydown", escape, true);
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      dragCleanup.current = null;
    };
    const cancel = () => { cleanup(); setDragTarget(null); };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (targetId) editTaskOrder((rows) => reorderTask(rows, id, targetId!, after));
      cancel();
    };
    const escape = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); cancel(); } };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", cancel);
    handle.addEventListener("lostpointercapture", cancel);
    document.addEventListener("keydown", escape, true);
    dragCleanup.current = cleanup;
  };
  const tops = openFirst(topLevel(all));
  const visible = tops.flatMap((parent) => [parent, ...(collapsed.has(parent.id) ? [] : openFirst(childrenOf(all, parent.id)))]);
  useLayoutEffect(() => {
    const focusId = focusTarget.current;
    if (!focusId) return;
    const input = [...panelRef.current!.querySelectorAll<HTMLInputElement>("[data-task-title]")].find((el) => el.dataset.taskTitle === focusId);
    input?.focus();
    focusTarget.current = null;
  }, [focusRequest]);
  const focusRow = (id?: string) => {
    if (!id) return;
    const task = tasks.get().find((t) => t.id === id);
    if (task?.parentId) setCollapsed((prev) => { const next = new Set(prev); next.delete(task.parentId!); return next; });
    focusTarget.current = id;
    setFocusRequest((request) => request + 1);
  };
  const remove = (id: string) => {
    const index = visible.findIndex((t) => t.id === id);
    const next = visible.slice(index + 1).find((t) => t.parentId !== id) ?? visible[index - 1];
    deleteTask(id);
    if (next && next.id !== id && next.parentId !== id) focusRow(next.id);
    else addRef.current?.focus();
  };
  const toggle = (id: string) => {
    const before = currentTask(tasks.get());
    toggleTaskGroup(id);
    if (before && !currentTask(tasks.get())) setBurst((n) => n + 1);
  };
  const done = all.filter((t) => t.done).length;
  return <aside ref={panelRef} className="panel tasks-panel" aria-label="Tasks" onKeyDown={(e) => {
    if (e.key !== "Escape" && (e.target as HTMLElement).closest("input:not([type=checkbox]):not([type=range]), textarea, [contenteditable], [role=dialog]")) e.stopPropagation();
  }}>
    <div className="panel-head">
      <span className="badge"><Icon.tasks /></span><h2>Tasks</h2>
      <span className="tasks-count" aria-label={`${done} of ${all.length} tasks completed`} aria-live="polite">{done}/{all.length}</span>
      <button className="iconbtn tasks-close" onClick={onClose} aria-label="Close tasks · Escape"><Icon.close /></button>
    </div>
    <div className="panel-body tasks-body">
      {tops.length ? <ul className="tasks-list">{tops.map((task) => <li className="task-group" key={task.id}>
        <ul className="tasks-list"><TaskRow onDrag={drag} dragTarget={dragTarget === task.id} task={task} all={all} isCurrent={active?.id === task.id} collapsed={collapsed.has(task.id)} onCollapse={() => setCollapsed((prev) => { const next = new Set(prev); if (next.has(task.id)) next.delete(task.id); else next.add(task.id); return next; })} onCreate={focusRow} onToggle={toggle} onDelete={remove} onNavigate={(id, dir) => { const i = visible.findIndex((t) => t.id === id); focusRow(visible[i + dir]?.id); }} /></ul>
        <ul id={`task-children-${task.id}`} className="tasks-list tasks-children" hidden={collapsed.has(task.id)}>{openFirst(childrenOf(all, task.id)).map((child) => <TaskRow onDrag={drag} dragTarget={dragTarget === child.id} key={child.id} task={child} all={all} isCurrent={active?.id === child.id} collapsed={false} onCollapse={() => {}} onCreate={focusRow} onToggle={toggle} onDelete={remove} onNavigate={(id, dir) => { const i = visible.findIndex((t) => t.id === id); focusRow(visible[i + dir]?.id); }} />)}</ul>
      </li>)}</ul> : <div className="tasks-empty">{[0, 1, 2].map((n) => <button key={n} className="task-placeholder" onClick={() => focusRow(insertTaskAfter())}><span className="task-placeholder-check" aria-hidden="true" /><span>Type your priority</span><Icon.plus /></button>)}</div>}
    </div>
    <footer className="tasks-footer">
      <div className="tasks-footer-actions"><button ref={addRef} className="tasks-add" onClick={() => focusRow(insertTaskAfter())}><Icon.plus />Add task</button>{done > 0 && <button className="tasks-clear" onClick={() => { clearDone(); addRef.current?.focus(); }}>Clear completed</button>}</div>
      <TaskSummary all={all} />
    </footer>
    <Confetti burst={burst} />
  </aside>;
}
