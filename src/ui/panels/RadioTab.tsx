import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { pinRadio, radioPlayer, radioStore, setRadioVolume } from "../../audio/radio";
import { RADIO_STATIONS, selectRadioStations } from "../../data/radio";
import { useStore } from "../../lib/store";
import { Icon } from "../icons";
import "./RadioTab.css";

function PinIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 3 6 0-1 6 4 4v2H6v-2l4-4zM12 15v6" /></svg>;
}
function ExternalIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3h7v7M21 3 10 14M10 3H4v17h17v-6" /></svg>;
}

export function RadioTab({ hidden = false }: { hidden?: boolean }) {
  const preferences = useStore(radioStore);
  const playback = useStore(radioPlayer.state);
  const [query, setQuery] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let mounted = true;
    void radioStore.ready.then(() => { if (mounted) setReady(true); });
    return () => { mounted = false; };
  }, []);
  const selected = RADIO_STATIONS.find((s) => s.id === (playback.stationId ?? preferences.lastStation)) ?? RADIO_STATIONS[0];
  const stations = selectRadioStations(query, preferences.pinned);
  const playing = playback.status === "playing";
  const engaged = playing || playback.status === "loading";
  return (
    <section className="radio-tab" hidden={hidden} aria-label="Internet radio">
      <label className="radio-search">
        Find a station
        <input className="input" type="search" placeholder="Find a station…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="radio-layout" aria-busy={!ready}>
        <ul className="radio-stations" aria-label="Radio stations">
          {stations.map((station) => {
            const active = selected.id === station.id;
            const paused = !active || !engaged;
            const pinned = preferences.pinned.includes(station.id);
            return (
              <li key={station.id} className={`radio-station${active ? " selected" : ""}`}>
                <button className="radio-station-play" disabled={!ready} aria-label={`${paused ? "Play" : "Pause"} ${station.name}`} aria-pressed={active && engaged} onClick={() => radioPlayer.toggle(station.id)}>
                  {paused ? <Icon.play /> : <Icon.pause />}
                  <span><b>{station.name}</b><span className="muted small">{station.description}</span></span>
                </button>
                <button className="iconbtn radio-pin" disabled={!ready} aria-label={`${pinned ? "Unpin" : "Pin"} ${station.name}`} aria-pressed={pinned} onClick={() => pinRadio(station.id)}><PinIcon /></button>
              </li>
            );
          })}
          {!stations.length && <li className="muted radio-empty">No stations match “{query}”.</li>}
        </ul>
        <div className="radio-player card">
          <div className={`radio-visualizer${playing ? " playing" : ""}`} aria-hidden="true">
            {Array.from({ length: 24 }, (_, i) => <span key={i} style={{ "--bar": `${28 + (i * 37 % 68)}%`, "--delay": `${-(i * 0.17)}s` } as CSSProperties} />)}
          </div>
          <span className="radio-live small muted">{playing ? "Live radio" : playback.status === "loading" ? "Connecting…" : playback.status === "error" ? "Unable to connect" : "Internet radio"}</span>
          <h3>{selected.name}</h3>
          <div className="radio-now-playing">
            <span aria-live="polite">{engaged ? playback.track ?? selected.name : "Choose a station and press play"}</span>
            <a className="iconbtn" href={selected.site} target="_blank" rel="noopener noreferrer" aria-label={`Visit ${selected.name} website`}><ExternalIcon /></a>
          </div>
          <div className="radio-transport">
            <button className="btn primary" disabled={!ready} aria-label={engaged ? "Pause radio" : "Play radio"} onClick={() => radioPlayer.toggle(selected.id)}>{engaged ? <Icon.pause /> : <Icon.play />}{engaged ? "Pause" : "Play"}</button>
            <button className="iconbtn" disabled={!ready} aria-label="Next radio station" onClick={() => radioPlayer.next()}><Icon.skip /></button>
          </div>
          <label className="radio-volume">Radio volume <output>{Math.round(preferences.volume * 100)}%</output>
            <input className="range" type="range" min="0" max="1" step="0.01" value={preferences.volume} disabled={!ready} onChange={(e) => setRadioVolume(Number(e.target.value))} />
          </label>
          <p className="muted small">Volume is relative to master</p>
          <a className="btn small radio-site" href={selected.site} target="_blank" rel="noopener noreferrer">Open station site <ExternalIcon /></a>
          <p className="small muted radio-status" role="status">{playback.error || (playback.status === "loading" ? "Connecting to the live stream…" : playback.status === "paused" ? "Radio paused." : "")}</p>
        </div>
      </div>
      <p className="muted small">Streams connect when you press play. Playback continues when this panel is closed. Track details appear when the station permits access.</p>
    </section>
  );
}
