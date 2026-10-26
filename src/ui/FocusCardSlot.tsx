import { useStore } from "../lib/store";
import { dismissReward, rewardMoment } from "../state/intent";
import { FocusCard } from "./FocusCard";
import { RecoveryCard } from "./RecoveryCard";
import { LongerOfferCard } from "./StartSupport";

export function FocusCardSlot({ onChooseTask }: { onChooseTask: () => void }) {
  const moment = useStore(rewardMoment);
  return <div className="focus-card-slot">
    <RecoveryCard onChooseTask={onChooseTask} fallback={moment ?
      <FocusCard title="Action finished" icon="circle-check" label="Your chosen reward" note="Your chosen reward is ready whenever you want it."
        className="reward-moment" onClose={() => dismissReward(moment.id)}>
        <p className="muted small">Finished: {moment.action}</p><p className="recovery-action">{moment.reward}</p>
      </FocusCard> : <LongerOfferCard />} />
  </div>;
}
