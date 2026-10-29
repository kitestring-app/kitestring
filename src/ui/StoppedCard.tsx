import { useState } from 'react';
import type { ReactNode } from 'react';
import { useStore } from '../lib/store';
import { settings } from '../state/settings';
import { useTimerView } from '../state/timer';
import { dismissStopOffer, recordStopLabel, removeStopLabel, stopAttempt, stopOutcomes } from '../state/stopOutcomes';
import type { StopAttempt, StopLabel } from '../state/stopOutcomes';
import { FocusCard } from './FocusCard';

export function StoppedCard({ fallback }: { fallback: ReactNode }) {
  const pending = useStore(stopAttempt), labels = useStore(stopOutcomes), hidden = useStore(settings, s => s.extras.hideStats);
  const view = useTimerView();
  if (hidden || !pending || view.state.segId !== pending.nextSegId || view.running || view.state.elapsedBefore > 0) return fallback;
  return <StopOffer key={pending.id} attempt={pending} label={labels[pending.id]} />;
}
function StopOffer({ attempt, label }: { attempt: StopAttempt; label?: StopLabel }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const focus = () => requestAnimationFrame(() => (document.querySelector<HTMLButtonElement>('.stopped-card .recovery-buttons button:not([disabled])') ?? document.querySelector<HTMLButtonElement>('[aria-label="Start · Space"]'))?.focus());
  const change = async (close = false) => {
    if (busy) return; setBusy(true); setError('');
    try {
      const result = await (close ? dismissStopOffer(attempt) : label ? removeStopLabel(label) : recordStopLabel(attempt.id));
      if (!result.ok) throw new Error('This stop has changed. Your recorded time is unchanged.');
      focus();
    } catch (cause) { setError((cause as Error).message || 'Could not save the label. Try again.'); }
    finally { setBusy(false); }
  };
  return <FocusCard title={label ? 'Deliberately stopped' : 'Session stopped'} icon="square" label="Optional stop label" className="stopped-card" keepVisible
    note="This label leaves recorded time, your task and your pin unchanged." onClose={() => void change(true)}
    actions={<div className="recovery-buttons"><button className="btn small" type="button" disabled={busy} onClick={() => void change()}>{busy ? 'Saving…' : label ? 'Undo label' : 'Record as deliberately stopped'}</button></div>}>
    {attempt.action && <p className="recovery-action">{attempt.action}</p>}
    <p className="faint small">Labels stay on this device. Focus data exports include them.</p>
    {label && <p className="small" role="status">Label saved.</p>}{error && <p className="small" role="alert">{error}</p>}
  </FocusCard>;
}
