import { useDashboardFit } from "./useDashboardFit";
import { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import { settings } from "../state/settings";
import { FlipFace } from "./timer/styles";
import { AmbientTimer } from "./AmbientTimer";
import "./ClockView.css";
import { QuoteLine } from "./QuoteLine";

const GREETINGS = {
  morning: ["Good morning", "Rise and focus", "Fresh start"],
  afternoon: ["Good afternoon", "Keep the momentum", "Deep work hours"],
  evening: ["Good evening", "Wind down well", "One more good block"],
  night: ["Burning the midnight oil", "Quiet hours", "Rest soon"],
};

export function useClock(seconds: boolean) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), seconds ? 1000 : 5000);
    return () => clearInterval(id);
  }, [seconds]);
  return now;
}

export function formatClock(d: Date, format: "12" | "24", seconds: boolean) {
  let h = d.getHours();
  if (format === "12") h = h % 12 || 12;
  const hh = format === "24" ? String(h).padStart(2, "0") : String(h);
  const mm = String(d.getMinutes()).padStart(2, "0");
  return seconds ? `${hh}:${mm}:${String(d.getSeconds()).padStart(2, "0")}` : `${hh}:${mm}`;
}

function greeting(d: Date, dynamic: boolean, name: string) {
  const h = d.getHours();
  const part = h < 5 ? "night" : h < 12 ? "morning" : h < 17 ? "afternoon" : h < 22 ? "evening" : "night";
  const list = GREETINGS[part];
  const g = dynamic ? list[d.getDate() % list.length] : list[0];
  return name ? `${g}, ${name}.` : `${g}.`;
}

export function ClockView({ ambient = false }: { ambient?: boolean }) {
  const fit = useDashboardFit();
  const c = useStore(settings, (s) => s.clock);
  const name = useStore(settings, (s) => s.extras.displayName);
  const showQuote = useStore(settings, (s) => s.quotes.inHome);
  const now = useClock(c.seconds);
  const text = formatClock(now, c.format, c.seconds);
  return (
    <section ref={fit} className={`center size-${c.size}`} aria-label="Clock">
      <div className="clock-row">
        {c.flip ? <FlipFace display={text} progress={0} showNumbers big /> : <div className="timer big">{text}</div>}
        {c.format === "12" && <span className="ampm">{now.getHours() < 12 ? "AM" : "PM"}</span>}
      </div>
      {ambient && <AmbientTimer />}
      {!ambient && c.greetings && <h1 className="headline" style={{ marginTop: 18 }}>{greeting(now, c.dynamicGreetings, name)}</h1>}
      {!ambient && showQuote && <QuoteLine />}
    </section>
  );
}

/** Retained export for older callers; raw history remains in the stats store. */
export function DashboardStreak() { return null; }
