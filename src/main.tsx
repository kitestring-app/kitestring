import { connectFloatingSettings } from "./ui/floatingDesktop";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import "./ui/Phone.css";
import { calmFoundationReady, localPreferencesReady, settings } from "./state/settings";
import { applyFont } from "./ui/settings/ClockTab";
import { MiniTimer } from "./ui/MiniTimer";
import { startTicker, timerActions, runTimerCommand } from "./state/timer";
import { flushReadyStores } from "./lib/store";
import { startSync } from "./lib/sync";

document.documentElement.dataset.desktop = String(!!window.desktop);

void settings.ready.then(() => applyFont(settings.get().clock.font));
const mini = window.desktop?.mini === true && new URLSearchParams(location.search).get("mini") === "1";
if (mini) startTicker({ follower: true });
else {
  void connectFloatingSettings();
  window.desktop?.onTimerRequest?.(runTimerCommand);
  window.desktop?.onTimerAction?.((action) => timerActions[action]());
  window.desktop?.onFlush?.(flushReadyStores);
}
if (!mini) void Promise.all([localPreferencesReady, calmFoundationReady]).then(startSync); // hosted version only: syncs to your account through Cloudflare Access + D1

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {mini ? <MiniTimer native /> : <App />}
  </StrictMode>,
);
