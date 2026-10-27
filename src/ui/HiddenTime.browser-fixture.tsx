import { createRoot } from "react-dom/client";
import { MiniTimer } from "./MiniTimer";

export function mountMinis() {
  for (const native of [false, true]) {
    const host = document.createElement("div");
    host.id = native ? "test-native" : "test-pip";
    document.body.append(host);
    createRoot(host).render(<MiniTimer native={native} />);
  }
}
