import { useMemo, useState } from 'react';
import { useStore } from '../../lib/store';
import { settings } from '../../state/settings';
import { removeStopLabel, stopOutcomes } from '../../state/stopOutcomes';
import type { StopLabel } from '../../state/stopOutcomes';
import './StopLabels.css';

export function StopLabels() {
  const labels = useStore(stopOutcomes), hidden = useStore(settings, s => s.extras.hideStats);
  const [page, setPage] = useState(0), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const rows = useMemo(() => Object.values(labels).sort((a, b) => b.at - a.at || a.id.localeCompare(b.id)), [labels]);
  const last = Math.max(0, Math.ceil(rows.length / 20) - 1), current = Math.min(page, last);
  const remove = async (label: StopLabel) => {
    if (busy) return; setBusy(label.id); setError('');
    try { if (!(await removeStopLabel(label)).ok) throw new Error('This label changed. Please try again.'); }
    catch (cause) { setError((cause as Error).message || 'Could not remove the label. Try again.'); }
    finally { setBusy(''); }
  };
  if (hidden || !rows.length) return null;
  return <section className="card stop-labels" aria-label="Deliberate stop labels">
    <h2>Deliberately stopped</h2><p className="help">Optional labels, separate from session filters. Removing a label keeps recorded time. Labels stay on this device; Focus data exports include them.</p>
    {error && <p role="alert">{error}</p>}
    <ul>{rows.slice(current * 20, current * 20 + 20).map(label => <li key={label.id}>
      <div><time dateTime={new Date(label.at).toISOString()}>{new Date(label.at).toLocaleString()}</time><p>{label.action || 'Focus session'}</p></div>
      <button className="btn small" disabled={!!busy} onClick={() => void remove(label)} type="button">{busy === label.id ? 'Removing…' : 'Remove label'}</button>
    </li>)}</ul>
    {last > 0 && <nav className="row" aria-label="Stop label pages"><button className="btn small" disabled={current === 0} onClick={() => setPage(current - 1)}>Newer</button><button className="btn small" disabled={current === last} onClick={() => setPage(current + 1)}>Older</button></nav>}
  </section>;
}
