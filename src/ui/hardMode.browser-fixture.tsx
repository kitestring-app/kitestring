// Imported only by the disposable-browser hard-mode test.
import { createRoot, type Root } from "react-dom/client";
import { MiniTimer } from "./MiniTimer";
let root: Root | undefined;
export function mountMini(native: boolean) {
  root?.unmount();
  document.getElementById("test-mini")?.remove();
  document.getElementById("root")!.style.display = "none";
  const mount = document.createElement("div");
  mount.id = "test-mini";
  document.body.append(mount);
  root = createRoot(mount);
  root.render(<MiniTimer native={native} />);
}

/** Return to the main window, where timer decisions live after 6d37432. */
export function restoreMain() {
  root?.unmount(); root = undefined;
  document.getElementById("test-mini")?.remove();
  document.getElementById("root")!.style.display = "";
}
