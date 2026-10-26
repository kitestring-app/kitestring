import { createRoot } from "react-dom/client";
import "./DeleteUndo.css";

interface Notice { id: number; message: string; undo: () => void; expires: number; timer: ReturnType<typeof setTimeout> }
interface ToastHost { node: HTMLDivElement; root: ReturnType<typeof createRoot>; notices: Notice[] }
let sequence = 0;
const hosts = new Map<HTMLElement, ToastHost>();

/** A separate root keeps Undo alive when deleting the last item unmounts its list. */
export function showDeleteUndo(message: string, undo: (() => void) | undefined, host: HTMLElement = document.body) {
  if (!undo) return;
  let state = hosts.get(host);
  if (!state) {
    const node = document.createElement("div");
    node.className = "delete-undo-stack";
    host.append(node);
    state = { node, root: createRoot(node), notices: [] };
    hosts.set(host, state);
  }
  const current = state;
  const remove = (notice: Notice) => {
    clearTimeout(notice.timer);
    current.notices = current.notices.filter(item => item !== notice);
    if (current.notices.length) render();
    else {
      hosts.delete(host);
      // The Undo button belongs to this root; let its event finish before unmounting.
      queueMicrotask(() => { current.root.unmount(); current.node.remove(); });
    }
  };
  const render = () => current.root.render(<>{current.notices.map(notice => <div className="delete-undo-toast" role="status" key={notice.id}>
    <span>{notice.message}</span>
    <button type="button" className="btn small" onClick={() => {
      remove(notice);
      if (Date.now() < notice.expires) notice.undo();
    }}>Undo</button>
  </div>)}</>);
  const notice: Notice = { id: ++sequence, message, undo, expires: Date.now() + 5000, timer: setTimeout(() => remove(notice), 5000) };
  current.notices.push(notice);
  render();
}
