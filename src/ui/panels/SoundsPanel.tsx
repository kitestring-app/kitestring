import { useEffect, useRef, useState } from "react";
import { getCtx, setMasterVolume } from "../../audio/core";
import { mixerStore, SoundMixer } from "../../audio/mixer";
import { useFloatingAudio } from "../../audio/floatingControls";
import { nowPlaying, radioPlayer } from "../../audio/radio";
import {
  CATEGORIES,
  clampVolume,
  FOCUS_PRESETS,
  SOUNDS,
} from "../../data/sounds";
import type { MixLayer } from "../../data/sounds";
import { Glyph, glyphFor, type GlyphName } from "../Glyph";
import { STATIONS, stationEmbed, toEmbedUrl } from "../../data/stations";
import type { MusicEmbed } from "../../data/stations";
import { uid, useStore } from "../../lib/store";
import { localPreferences, localPreferencesReady, localPreferencesUpdate, settings, settingsUpdate } from "../../state/settings";
import { Icon } from "../icons";
import { RadioTab } from "./RadioTab";
import "./SoundsPanel.css";

type Tab = "Sounds" | "My Music" | "Stations" | "Radio";
type Player = MusicEmbed & { name: string };

export function SoundsPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const data = useStore(mixerStore);
  const savedMaster = useStore(settings, (s) => s.sounds.master);
  const muted = useStore(localPreferences, s => s.muted);
  const master = muted ? 0 : savedMaster;
  const [engine] = useState(() => new SoundMixer());
  const [tab, setTab] = useState<Tab>("Sounds");
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [engaged, setEngaged] = useState(false);
  const [status, setStatus] = useState("");
  const [player, setPlayer] = useState<Player | null>(null);
  const suspendedMusic = useRef<Player | null>(null);
  const resumeAmbient = useRef(false);

  useEffect(() => { radioPlayer.setMasterVolume(master); }, [master]);

  useEffect(() => nowPlaying.subscribe(() => {
    if (nowPlaying.get() === "radio") { suspendedMusic.current = null; setPlayer(null); }
  }), []);
  const playMusic = (next: Player) => {
    suspendedMusic.current = null;
    nowPlaying.set("embed");
    setPlayer(next);
  };

  useEffect(() => {
    let mounted = true;
    void Promise.all([mixerStore.ready, settings.ready, localPreferencesReady]).then(() => {
      if (mounted) setReady(true);
    });
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => () => engine.dispose(), [engine]);
  useEffect(() => {
    if (engaged) setMasterVolume(clampVolume(master));
  }, [engaged, master]);
  useEffect(() => {
    if (!engaged) return;
    void engine
      .sync(data.layers, playing, (id) => {
        setStatus(
          `${SOUNDS.find((s) => s.id === id)?.name ?? "Sound"} could not play. Select it again to retry.`,
        );
        mixerStore.set((s) => ({
          ...s,
          layers: s.layers.filter((l) => l.id !== id),
        }));
      })
      .catch(() => {
        setPlaying(false);
        setStatus("Audio could not start. Try Play mix again.");
      });
  }, [engine, engaged, data.layers, playing]);

  const play = () => {
    try {
      getCtx();
      setMasterVolume(clampVolume(master));
      setEngaged(true);
      setPlaying(true);
      setStatus("");
    } catch {
      setStatus("Web Audio is unavailable in this browser.");
    }
  };
  const toggle = (id: string) => {
    const has = data.layers.some((l) => l.id === id);
    mixerStore.set((s) => ({
      ...s,
      layers: has
        ? s.layers.filter((l) => l.id !== id)
        : [...s.layers, { id, volume: 0.5 }],
    }));
    if (!has) play();
  };
  const apply = (layers: MixLayer[]) => {
    mixerStore.set((s) => ({ ...s, layers: layers.map((l) => ({ ...l })) }));
    play();
  };
  const volume = (id: string, value: number) =>
    mixerStore.set((s) => ({
      ...s,
      layers: s.layers.map((l) => (l.id === id ? { ...l, volume: value } : l)),
    }));

  useFloatingAudio({
    playing: (playing && data.layers.length > 0) || player !== null,
    available: (engaged && data.layers.length > 0) || player !== null || suspendedMusic.current !== null,
    toggle: () => {
      if (playing || player) {
        resumeAmbient.current = playing;
        setPlaying(false);
        if (player) {
          suspendedMusic.current = player;
          setPlayer(null); // provider embeds have no shared pause API; release their audio
          if (nowPlaying.get() === "embed") nowPlaying.set(null);
        }
      } else {
        const previous = suspendedMusic.current;
        if (previous) playMusic(previous);
        if (data.layers.length && (resumeAmbient.current || !previous)) play();
      }
    },
  });

  return (
    <aside
      className="panel wide sounds-panel"
      hidden={!open}
      aria-label="Sounds and music"
      onKeyDown={(event) => {
        // Let Space activate focused buttons without also starting the dashboard timer.
        if (
          event.code === "Space" &&
          (event.target as HTMLElement).closest("button")
        )
          event.stopPropagation();
      }}
    >
      <div className="panel-head">
        <span className="badge">
          <Icon.music />
        </span>
        <h2>Sounds & music</h2>
        <button
          className="iconbtn sounds-close"
          onClick={onClose}
          aria-label="Close sounds · Escape"
        >
          <Icon.close />
        </button>
      </div>
      <div className="panel-body">
        <nav
          className="ptabs sounds-tabs"
          aria-label="Sounds and music sections"
        >
          {(["Sounds", "My Music", "Stations", "Radio"] as Tab[]).map((t) => (
            <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </nav>
        {tab === "Sounds" && (
          <p className="muted small sounds-guide">
            Try sound or silence. Keep what works for this task. Binaural tiles need headphones.{" "}
            <a href="/research.html" target="_blank" rel="noopener">Why these sounds</a>
          </p>
        )}
        {!ready ? (
          <p role="status">Loading your mixes…</p>
        ) : (
          <>
            {tab === "Sounds" && (
              <MixerControls
                layers={data.layers}
                playing={playing && !!data.layers.length}
                onPlay={play}
                onPause={() => setPlaying(false)}
                onToggle={toggle}
                onVolume={volume}
                onApply={apply}
                onStatus={setStatus}
              />
            )}
            {tab === "My Music" && (
              <MyMusic
                player={player}
                onPlay={playMusic}
                onStatus={setStatus}
              />
            )}
            {tab === "Stations" && (
              <>
                <p className="muted small">
                  Choose a live station. Only one music player runs at a time.
                </p>
                <div className="sounds-stations">
                  {STATIONS.map((s) => (
                    <button
                      className="sounds-station"
                      key={s.id}
                      aria-pressed={player?.url === stationEmbed(s)}
                      onClick={() => {
                        playMusic({
                          provider: "YouTube",
                          name: s.name,
                          url: stationEmbed(s),
                        });
                        setStatus("");
                      }}
                    >
                      <Glyph name={s.glyph} size={22} />
                      <b>{s.name}</b>
                      <span className="muted small">{s.description}</span>
                      <span className="small">
                        {player?.url === stationEmbed(s)
                          ? "Selected"
                          : "Play station"}
                      </span>
                    </button>
                  ))}
                </div>
                <h3 className="sounds-subhead">Focus noise presets</h3>
                <div className="sounds-wrap">
                  {FOCUS_PRESETS.map((p) => (
                    <button
                      className="btn small"
                      key={p.name}
                      onClick={() => {
                        apply(p.layers);
                        setTab("Sounds");
                      }}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
        <RadioTab hidden={tab !== "Radio"} />
        {/* Keep this exact iframe mounted across panel visibility and tab changes. */}
        <div className="sounds-player" hidden={!player}>
          <div className="sounds-wrap">
            <b>{player?.name}</b>
            <button className="btn small" onClick={() => {
              suspendedMusic.current = null;
              setPlayer(null);
              if (nowPlaying.get() === "embed") nowPlaying.set(null);
            }}>
              <Icon.stop />
              Stop music
            </button>
          </div>
          {player && (
            <iframe
              key={player.url}
              src={player.url}
              title={`${player.name} player`}
              allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
              sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          )}
          <p className="muted small">
            Music needs an internet connection and may require a provider login.
            {typeof window !== "undefined" && window.desktop ? "YouTube playback follows the Mac app’s allowlist." : "YouTube links only play if allowed by your browser policy."} Mixer
            volume controls ambient sounds; use the player's volume for music.
          </p>
        </div>
        <p className="sounds-status small" role="status">
          {status}
        </p>
      </div>
    </aside>
  );
}

interface MixerProps {
  layers: MixLayer[];
  playing: boolean;
  onPlay: () => void;
  onPause: () => void;
  onToggle: (id: string) => void;
  onVolume: (id: string, value: number) => void;
  onApply: (layers: MixLayer[]) => void;
  onStatus: (message: string) => void;
}
function MixerControls({
  layers,
  playing,
  onPlay,
  onPause,
  onToggle,
  onVolume,
  onApply,
  onStatus,
}: MixerProps) {
  const { mixes } = useStore(mixerStore);
  const master = useStore(settings, (s) => s.sounds.master);
  const muted = useStore(localPreferences, s => s.muted);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("All");
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState("");
  return (
    <>
      <div className="sounds-toolbar">
        <button
          className="btn primary"
          disabled={!layers.length}
          onClick={playing ? onPause : onPlay}
        >
          {playing ? <Icon.pause /> : <Icon.play />}
          {playing ? "Pause all" : "Play mix"}
        </button>
        <span className="muted small">
          {layers.length} {layers.length === 1 ? "layer" : "layers"}
          {layers.length
            ? playing
              ? " playing"
              : " paused"
            : " · select sounds below"}
        </span>
        <label className="sounds-master small">
          Master {muted && <span role="status">Muted</span>} <output>{Math.round(clampVolume(master) * 100)}%</output>
          <input
            className="range"
            type="range"
            min="0"
            max="1"
            step="0.01"
            aria-label="Master volume"
            value={clampVolume(master)}
            onChange={(e) => {
              settingsUpdate("sounds", { master: Number(e.target.value) });
              localPreferencesUpdate({ muted: false });
            }}
          />
        </label>
      </div>
      <div className="sounds-wrap sounds-mixes">
        <button className="btn small" aria-pressed={muted} onClick={() => localPreferencesUpdate({ muted: !muted })}>{muted ? "Unmute audio" : "Mute audio"}</button>
        <button
          className="btn small"
          disabled={!layers.length}
          onClick={() => setSaving(!saving)}
        >
          Save mix
        </button>
        <label className="sounds-mix-select small">
          <span className="sr-only">Saved mixes</span>
          <select
            className="input"
            value={selected}
            onChange={(e) => {
              const id = e.target.value;
              setSelected(id);
              const mix = mixes.find((m) => m.id === id);
              if (mix) {
                onApply(mix.layers);
                onStatus(`Loaded ${mix.name}.`);
              }
            }}
          >
            <option value="">Saved mixes…</option>
            {mixes.map((m) => (
              <option value={m.id} key={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        {selected && (
          <>
            <button
              className="btn small"
              onClick={() => {
                const mix = mixes.find((m) => m.id === selected);
                if (mix) onApply(mix.layers);
              }}
            >
              Reload mix
            </button>
            <button
              className="iconbtn"
              aria-label="Delete selected mix"
              onClick={() => {
                mixerStore.set((s) => ({
                  ...s,
                  mixes: s.mixes.filter((m) => m.id !== selected),
                }));
                setSelected("");
                onStatus("Mix deleted.");
              }}
            >
              <Icon.trash />
            </button>
          </>
        )}
      </div>
      {saving && (
        <form
          className="sounds-wrap sounds-save"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim() || !layers.length) return;
            const id = uid();
            mixerStore.set((s) => ({
              ...s,
              mixes: [
                ...s.mixes,
                {
                  version: 1,
                  id,
                  name: name.trim().slice(0, 60),
                  layers: layers.map((l) => ({ ...l })),
                },
              ],
            }));
            setSelected(id);
            setSaving(false);
            setName("");
            onStatus("Mix saved on this device.");
          }}
        >
          <label>
            Mix name
            <input
              className="input"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              placeholder="Rainy afternoon"
              required
            />
          </label>
          <button
            className="btn small"
            disabled={!name.trim() || !layers.length}
          >
            Save
          </button>
          <button
            type="button"
            className="btn small"
            onClick={() => setSaving(false)}
          >
            Cancel
          </button>
        </form>
      )}
      <div
        className="sounds-categories"
        role="group"
        aria-label="Sound category"
      >
        {CATEGORIES.map((c) => (
          <button
            key={c}
            className="btn small"
            aria-pressed={c === category}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>
      <p className="muted small">
        Layer sounds to make your own space. Binaural tones: use headphones. The
        16 Hz pulse modulates only the 200 Hz–1 kHz band.
      </p>
      <div className="sounds-grid">
        {SOUNDS.filter(
          (s) => category === "All" || s.category === category,
        ).map((s) => {
          const layer = layers.find((l) => l.id === s.id);
          return (
            <div className={`sound-tile${layer ? " active" : ""}`} key={s.id}>
              <button
                className="sound-toggle"
                aria-pressed={!!layer}
                onClick={() => onToggle(s.id)}
              >
                <span className="sound-emoji">
                  <Glyph name={s.glyph} size={26} />
                </span>
                <b>{s.name}</b>
                {s.beat ? <span className="sound-note">Headphones</span> : null}
              </button>
              {layer && (
                <label className="sound-volume small">
                  Volume <output>{Math.round(layer.volume * 100)}%</output>
                  <input
                    className="range"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    aria-label={`${s.name} volume`}
                    value={layer.volume}
                    onChange={(e) => onVolume(s.id, Number(e.target.value))}
                  />
                </label>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function MyMusic({
  player,
  onPlay,
  onStatus,
}: {
  player: Player | null;
  onPlay: (p: Player) => void;
  onStatus: (message: string) => void;
}) {
  const { favourites } = useStore(mixerStore);
  const [input, setInput] = useState("");
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState<GlyphName>("music");
  const parsed = toEmbedUrl(input);
  const duplicate = player && favourites.some((f) => f.url === (player.sourceUrl ?? player.url));
  return (
    <>
      <p className="muted small">
        Paste a Spotify track, album or playlist, Apple Music, Amazon Music,
        YouTube, or SoundCloud track or playlist link.
      </p>
      <form
        className="sounds-wrap sounds-url"
        onSubmit={(e) => {
          e.preventDefault();
          if (!parsed) {
            onStatus(
              "Use a full HTTPS music link from one of the supported providers.",
            );
            return;
          }
          onPlay({ ...parsed, name: name.trim() || parsed.provider });
          onStatus("");
        }}
      >
        <label>
          Music URL
          <input
            className="input"
            type="url"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="https://open.spotify.com/playlist/…"
            required
            aria-describedby="sounds-url-help"
          />
        </label>
        <button className="btn primary">Load player</button>
      </form>
      <p id="sounds-url-help" className="muted small">
        {input && !parsed
          ? "This link is not supported. Use the full provider URL, rather than a shortened share link."
          : "The provider connects only after you load its player. SoundCloud links must start with https://soundcloud.com/ and have no query parameters."}
      </p>
      <div className="sounds-wrap sounds-favourite-form">
        <label>
          Name
          <input
            className="input"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            placeholder="My focus playlist"
          />
        </label>
        <div className="fav-icons" role="group" aria-label="Icon">
          {(["music", "coffee", "moon", "leaf", "keyboard-music", "radio", "sparkles"] as GlyphName[]).map((v) => (
            <button key={v} type="button" className="iconbtn small" aria-pressed={emoji === v} aria-label={v.replace("-", " ")} onClick={() => setEmoji(v)}>
              <Glyph name={v} size={18} />
            </button>
          ))}
        </div>
        <button
          className="btn small"
          disabled={!player || !!duplicate || favourites.length >= 5}
          onClick={() => {
            if (!player) return;
            mixerStore.set((s) =>
              s.favourites.length >= 5 ||
              s.favourites.some((f) => f.url === (player.sourceUrl ?? player.url))
                ? s
                : {
                    ...s,
                    favourites: [
                      ...s.favourites,
                      {
                        id: uid(),
                        name: name.trim() || player.name,
                        emoji,
                        url: player.sourceUrl ?? player.url,
                      },
                    ],
                  },
            );
            onStatus("Favourite saved on this device.");
          }}
        >
          Save to favourites
        </button>
      </div>
      <h3 className="sounds-subhead">
        Favourites <span className="muted small">{favourites.length}/5</span>
      </h3>
      {!favourites.length && (
        <p className="muted small">
          Load a player, then save it here for next time.
        </p>
      )}
      {favourites.length >= 5 && (
        <p className="muted small">
          Five favourites saved. Remove one to make room.
        </p>
      )}
      <div className="sounds-favourites">
        {favourites.map((f) => (
          <div className="sounds-wrap" key={f.id}>
            <button
              className="btn"
              aria-pressed={(player?.sourceUrl ?? player?.url) === f.url}
              onClick={() => {
                const embed = toEmbedUrl(f.url);
                if (embed) {
                  onPlay({ ...embed, name: f.name });
                  setInput(f.url);
                  setName(f.name);
                  setEmoji(glyphFor(f.emoji) ?? "music");
                  onStatus("");
                }
              }}
            >
              <Glyph name={glyphFor(f.emoji) ?? "music"} size={18} />
              {f.name}
            </button>
            <button
              className="iconbtn"
              aria-label={`Remove ${f.name} favourite`}
              onClick={() =>
                mixerStore.set((s) => ({
                  ...s,
                  favourites: s.favourites.filter((v) => v.id !== f.id),
                }))
              }
            >
              <Icon.trash />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
