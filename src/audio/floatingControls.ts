import { useEffect, useRef } from "react";
import { localPreferences, localPreferencesUpdate, settings, settingsUpdate } from "../state/settings";
import { radioPlayer } from "./radio";

interface MixControls { playing: boolean; available: boolean; toggle: () => void }
/** Runs in the audio-owning dashboard, including when its Sounds panel is hidden. */
export function useFloatingAudio(mix: MixControls) {
  const current = useRef(mix);
  current.current = mix;
  const resume = useRef({ mix: false, radio: false });
  useEffect(() => {
    const bridge = window.desktop;
    if (!bridge?.publishAudioState) return;
    const publish = () => {
      const volume = settings.get().sounds.master;
      const radio = radioPlayer.state.get();
      bridge.publishAudioState!({ volume, muted: localPreferences.get().muted,
        playing: current.current.playing || radio.status === "playing" || radio.status === "loading",
        available: current.current.available || radio.stationId !== null });
    };
    const command = (value: FloatingAudioCommand) => {
      if (value.action === "volume") { settingsUpdate("sounds", { master: value.value }); localPreferencesUpdate({ muted: false }); }
      else if (value.action === "mute") localPreferencesUpdate({ muted: !localPreferences.get().muted });
      else {
        const radio = radioPlayer.state.get();
        const radioPlaying = radio.status === "playing" || radio.status === "loading";
        if (radioPlaying || current.current.playing) {
          resume.current = { mix: current.current.playing, radio: radioPlaying };
          if (radioPlaying) radioPlayer.pause();
          if (current.current.playing) current.current.toggle();
        } else {
          if (resume.current.radio && radio.stationId) radioPlayer.toggle(radio.stationId);
          if (current.current.available && (resume.current.mix || !radio.stationId)) current.current.toggle();
          else if (!resume.current.radio && radio.stationId) radioPlayer.toggle(radio.stationId);
        }
      }
      publish();
    };
    const off = [settings.subscribe(publish), localPreferences.subscribe(publish), radioPlayer.state.subscribe(publish), bridge.onAudioAction?.(command), bridge.onAudioRequest?.(publish)];
    publish();
    return () => off.forEach(fn => fn?.());
  }, []);
  useEffect(() => {
    const radio = radioPlayer.state.get();
    const volume = settings.get().sounds.master;
    window.desktop?.publishAudioState?.({ volume, muted: localPreferences.get().muted, playing: mix.playing || radio.status === "playing" || radio.status === "loading", available: mix.available || radio.stationId !== null });
  }, [mix.playing, mix.available]);
}
