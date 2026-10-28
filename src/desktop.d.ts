export {};

declare global {
  type DesktopMenuCommand = "settings" | "home" | "focus" | "ambient" | "tasks" | "sounds" | "notes" | "toggle" | "skip" | "reset" | "shortcuts" | "stopSound" | "stopAndPause" | "stop" | "endSession";
  type DesktopTimerAction = "toggle" | "pause" | "reset" | "skip" | "stop" | "stopSound" | "stopAndPause";
  type DesktopTimerCommand = DesktopTimerAction | "beginEndHold" | "cancelEndHold" | { action: "endHardSession"; reason: string };
  type DesktopTimerOrigin = "accelerator" | "pointer";
  type DesktopTimerResult = import("./state/timer").TimerCommandResult | { ok: false; reason: "unavailable" | "invalid-command" };
  interface DesktopTimerState { segment: "focus" | "short" | "long"; running: boolean; hasProgress: boolean; ringing: boolean; sounding: boolean; hardLocked?: boolean }
  interface FloatingPreferences { floatingTimer: boolean; floatingOnTop: boolean; menuBarTime: boolean; showMenuBar: boolean }
  type FloatingAudioCommand = { action: "volume"; value: number } | { action: "mute" | "toggle" };
  interface FloatingAudioState { volume: number; muted: boolean; playing: boolean; available: boolean }
  interface DesktopAnnouncement {
    phase: "focus" | "break" | "cycle";
    minutes?: number;
  }
  interface DesktopAlarm {
    at: number;
    kind: "focus-done" | "break-over";
    alertSound: import("./state/settings").Settings["timer"]["alertSound"];
    volume: number;
    speak: boolean;
    notify?: boolean;
    attention?: boolean;
    announcement?: DesktopAnnouncement;
    genericSpeech?: boolean;
  }
  interface CloudReply { status: number; retryAfter?: string | null; data: { ok: boolean; email?: string; error?: string; entries?: { key: string; value: unknown; updatedAt: number }[] } }
  interface Window {
    desktop?: {
      platform?: string;
      getFullScreen?: () => Promise<boolean | null>;
      onFullScreenChange?: (callback: (fullscreen: boolean) => void) => () => void;
      cloud?: {
        signIn(email: string, password: string): Promise<CloudReply>;
        signOut(): Promise<CloudReply>;
        status(): Promise<CloudReply>;
        request(method: string, path: string, body?: unknown): Promise<CloudReply>;
        openReset(): Promise<boolean>;
      };
      getSecureDns?: () => Promise<string | null>;
      setSecureDns?: (url: string) => Promise<boolean>;
      onMenuCommand?: (callback: (command: DesktopMenuCommand) => void) => () => void;
      parkingStatus?: () => Promise<{ registered: boolean } | null>;
      consumeSuspensionAt?: () => { at: number; suspended: boolean } | null;
      consumeSuspension?: () => boolean;
      onLifecycle?: (callback: (event: "resume" | "activate" | "suspend") => void) => () => void;
      onParked?: (callback: (text: string) => void) => () => void;
      mini?: boolean;
      setFloatingPreferences?: (value: FloatingPreferences) => Promise<boolean>;
      onFloatingPreferences?: (callback: (value: FloatingPreferences) => void) => () => void;
      audioControl?: (value: FloatingAudioCommand) => void;
      requestAudioState?: () => void;
      onAudioState?: (callback: (value: FloatingAudioState) => void) => () => void;
      publishAudioState?: (value: FloatingAudioState) => void;
      onAudioAction?: (callback: (value: FloatingAudioCommand) => void) => () => void;
      onAudioRequest?: (callback: () => void) => () => void;
      publishTimerState?: (state: DesktopTimerState) => void;
      requestTimerState?: () => void;
      onTimerState?: (callback: (state: DesktopTimerState) => void) => () => void;
      setStatus?: (text: string) => void;
      attention?: (kind: "focus-done" | "break-over") => void;
      release?: () => void;
      toggleFullScreen?: () => Promise<boolean | null>;
      onFullScreenTransition?: (callback: (phase: "start" | "end") => void) => () => void;
      floatTimer?: (open: boolean) => Promise<boolean>;
      onFloatTimer?: (callback: (open: boolean) => void) => () => void;
      showMain?: () => void;
      timerControl?: (action: DesktopTimerCommand | "endSession") => Promise<DesktopTimerResult>;
      onTimerRequest?: (callback: (action: DesktopTimerCommand, origin?: DesktopTimerOrigin) => Promise<DesktopTimerResult>) => () => void;
      armAlarm?: (alarm: DesktopAlarm) => Promise<boolean>;
      disarmAlarm?: () => void;
      speak?: (input: { kind: DesktopAlarm["kind"]; announcement?: DesktopAnnouncement }) => Promise<boolean>;
      cancelSpeech?: () => void;
      notificationStatus?: () => Promise<{ supported: boolean; failed: boolean }>;
      testReminder?: () => Promise<{ supported: boolean; failed: boolean; displays: number } | null>;
      preventSleep?: (on: boolean) => void;
      onTimerAction?: (callback: (action: DesktopTimerAction) => void) => () => void;
      onFlush?: (callback: () => Promise<void>) => () => void;
    };
  }
}
