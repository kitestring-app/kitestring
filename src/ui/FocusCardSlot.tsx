import type { ReactNode } from "react";
import { useTimerView } from "../state/timer";
import { BreathingBreak } from "./BreathingBreak";
import { useStore } from "../lib/store";
import { dismissReward, rewardMoment } from "../state/intent";
import { FocusCard } from "./FocusCard";
import { RecoveryCard } from "./RecoveryCard";
import { LongerOfferCard } from "./StartSupport";
import { StoppedCard } from './StoppedCard';

export function FocusCardSlot({ onChooseTask, onRecall }: { onChooseTask: () => void; onRecall?: () => void }) {
  const moment = useStore(rewardMoment);
  const view = useTimerView();
  const recovery = (fallback: ReactNode) => <RecoveryCard onChooseTask={onChooseTask} fallback={moment ?
      <FocusCard title="Action finished" icon="circle-check" label="Your chosen reward" note="Your chosen reward is ready whenever you want it."
        className="reward-moment" onClose={() => dismissReward(moment.id)}>
        <p className="muted small">Finished: {moment.action}</p><p className="recovery-action">{moment.reward}</p>
      </FocusCard> : <StoppedCard fallback={fallback} />} />;
  return <><div className="focus-card-slot">
    {view.state.segment !== "focus" ?
      <BreathingBreak key={view.state.segId} hiddenTime={view.hiddenTime}>{guide => recovery(guide)}</BreathingBreak> :
      recovery(<LongerOfferCard />)}
  </div>
    {onRecall && view.state.startedAt === null && (view.state.elapsedBefore > 0 || view.state.segment !== "focus" || view.state.reentry || view.state.boundary || (view.state.context?.spentMs ?? 0) > 0) && <button className="btn small chrome" onClick={onRecall}>Explain from memory in Notes</button>}
  </>;
}
