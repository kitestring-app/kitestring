// Timer faces. Each style renders the same props. Default is here; the rest live in ./styles/*.
import type { TimerStyle } from "../../state/settings";
import { FlipFace, BarFace, GaugeFace, DotsFace, PieFace } from "./styles";

export interface FaceProps {
  display: string; // "24:58" or "1:02:03"
  progress: number; // 0..1 elapsed fraction (0 for stopwatch)
  showNumbers: boolean;
  big?: boolean; // dashboard size vs. compact (PiP, previews)
}

export function DefaultFace({ display, big = true }: FaceProps) {
  return <div className={`timer ${big ? "big" : ""}`}>{display}</div>;
}

export const FACES: Record<TimerStyle, (p: FaceProps) => React.ReactNode> = {
  default: DefaultFace,
  flip: FlipFace,
  bar: BarFace,
  gauge: GaugeFace,
  dots: DotsFace,
  pie: PieFace,
};
