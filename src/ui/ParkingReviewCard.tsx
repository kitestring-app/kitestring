import { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import { parked } from "../state/parked";
import { currentReviewItem, parkingReview } from "../state/parkingReview";
import { requestParkingRecovery, recoveryCommand, type ParkingRecoveryAnswer } from "../state/timer";
import { FocusCard } from "./FocusCard";
import { showDeleteUndo } from "./stats/DeleteUndo";

export function ParkingReviewCard() {
  const state = useStore(parkingReview);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useStore(parked);
  const review = state.review, item = currentReviewItem();
  useEffect(() => setError(""), [review?.id, item?.id]);
  const command = recoveryCommand();
  const answer = async (choice: ParkingRecoveryAnswer) => {
    setBusy(true);
    try {
      const result = await requestParkingRecovery(command, item?.id ?? "", choice);
      setError(result.ok ? "" : "This review has changed. Use the current card.");
      if (result.undo) showDeleteUndo("Thought dropped.", result.undo, document.body);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  if (!review) return null;
  return <FocusCard title="Parked thoughts" icon="notebook-pen" label="Review parked thoughts"
    note="Keep a thought, make it a task, or drop it." onClose={() => { if (!busy) void answer("defer"); }} actions={
    <div className="recovery-buttons">
      {item && ([['keep', 'Keep'], ['task', 'Make a task'], ['drop', 'Drop']] as const).map(([choice, label]) => <button className={`btn ${choice === "keep" ? "primary" : ""}`} disabled={busy} key={choice} onClick={() => void answer(choice)}>{label}</button>)}
      <button className={`btn ${item ? "small" : "primary"}`} disabled={busy} onClick={() => void answer(item ? "defer" : "close")}>{item ? "Review later" : "Done reviewing"}</button>
    </div>}>
    {item ? <p className="recovery-action">{item.text}</p> : <p>Nothing waiting in this review.</p>}
    {error && <p className="small" role="status">{error}</p>}
  </FocusCard>;
}
