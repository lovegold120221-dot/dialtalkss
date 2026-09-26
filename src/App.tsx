import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Bluetooth,
  EllipsisVertical,
  Headphones,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Plus,
  Video,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Room, RoomEvent, Track, type RemoteTrack } from "livekit-client";

type CallState = "idle" | "ringing" | "connecting" | "active" | "error";

const RINGTONE_URL =
  "https://cdn.pixabay.com/audio/2025/07/30/audio_a4cedca394.mp3?filename=dragon-studio-phone-ringing-382734.mp3";
const RING_DURATION_MS = 8_000;
const BAR_COUNT = 17;
const CONTACT_NAME = "Abitech CSR";
const CONTACT_SUBTITLE = "ABI Tech Customer Service";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function elapsed(seconds: number) {
  return String(Math.floor(seconds / 60)).padStart(2, "0") +
    ":" +
    String(seconds % 60).padStart(2, "0");
}

function localTime() {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

export default function App() {
  const [callState, setCallState] = useState<CallState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(true);
  const [number, setNumber] = useState("0968 178 9779");
  const [error, setError] = useState<string | null>(null);
  const [levels, setLevels] = useState<number[]>(() => Array(BAR_COUNT).fill(0.12));

  const roomRef = useRef<Room | null>(null);
  const audioHostRef = useRef<HTMLDivElement | null>(null);
  const ringtoneRef = useRef<HTMLAudioElement | null>(null);
  const callAttemptRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | null>(null);

  const isLive = callState === "active";
  const isRinging = callState === "ringing";
  const isConnecting = callState === "connecting";
  const isBusy = isLive || isRinging || isConnecting;

  const statusText = useMemo(() => {
    if (isRinging) return "Calling…";
    if (isConnecting) return "Connecting…";
    if (isLive) return elapsed(seconds);
    if (callState === "error") return "Call failed";
    return "Ready to call";
  }, [callState, isConnecting, isLive, isRinging, seconds]);

  useEffect(() => {
    if (!isLive) return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [isLive]);

  useEffect(() => {
    if (!isLive) {
      setLevels(Array(BAR_COUNT).fill(0.12));
      return;
    }

    const frame = () => {
      const analyser = analyserRef.current;
      if (analyser) {
        const bins = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(bins);

        setLevels(
          Array.from({ length: BAR_COUNT }, (_, index) => {
            const start = Math.floor((index * bins.length) / BAR_COUNT);
            const end = Math.max(
              start + 1,
              Math.floor(((index + 1) * bins.length) / BAR_COUNT),
            );
            let sum = 0;
            for (let i = start; i < end; i += 1) sum += bins[i] ?? 0;
            return Math.max(0.1, Math.min(1, sum / (end - start) / 150));
          }),
        );
      }
      animationRef.current = window.requestAnimationFrame(frame);
    };

    animationRef.current = window.requestAnimationFrame(frame);
    return () => {
      if (animationRef.current) window.cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    };
  }, [isLive]);

  useEffect(() => {
    const ringtone = new Audio(RINGTONE_URL);
    ringtone.preload = "auto";
    ringtone.volume = 0.9;
    ringtoneRef.current = ringtone;

    return () => {
      callAttemptRef.current += 1;
      ringtone.pause();
      ringtone.currentTime = 0;
      roomRef.current?.disconnect();
      if (animationRef.current) window.cancelAnimationFrame(animationRef.current);
      void audioContextRef.current?.close();
    };
  }, []);

  async function connectVisualizer(track: RemoteTrack) {
    const mediaTrack = track.mediaStreamTrack;
    if (!mediaTrack) return;

    if (audioContextRef.current) {
      await audioContextRef.current.close().catch(() => undefined);
    }

    const context = new AudioContext();
    const stream = new MediaStream([mediaTrack]);
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();

    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.84;
    source.connect(analyser);

    audioContextRef.current = context;
    analyserRef.current = analyser;

    if (context.state === "suspended") {
      await context.resume().catch(() => undefined);
    }
  }

  async function startCall() {
    if (isBusy) return;

    const attempt = ++callAttemptRef.current;
    setCallState("ringing");
    setSeconds(0);
    setError(null);

    const ringtone = ringtoneRef.current ?? new Audio(RINGTONE_URL);
    ringtoneRef.current = ringtone;
    ringtone.currentTime = 0;
    ringtone.loop = false;
    ringtone.volume = 0.9;

    try {
      await ringtone.play();
    } catch {
      // Keep the call flow working even if the browser blocks the ringtone.
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, RING_DURATION_MS));
    if (attempt !== callAttemptRef.current) return;

    ringtone.pause();
    ringtone.currentTime = 0;
    setCallState("connecting");

    try {
      const response = await fetch("/api/livekit-token", { method: "POST" });
      const data = await response.json() as {
        server_url?: string;
        participant_token?: string;
        error?: string;
      };

      if (!response.ok || !data.server_url || !data.participant_token) {
        throw new Error(data.error || "Could not create a LiveKit session.");
      }

      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;

      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio) return;

        const element = track.attach();
        element.autoplay = true;
        element.muted = !speaker;
        element.dataset.abbieAudio = "1";
        audioHostRef.current?.appendChild(element);

        void connectVisualizer(track);
      });

      room.on(RoomEvent.Disconnected, () => {
        setCallState("idle");
        setMuted(false);
        analyserRef.current = null;
      });

      await room.connect(data.server_url, data.participant_token);
      await room.startAudio();
      await room.localParticipant.setMicrophoneEnabled(true);
      setCallState("active");
    } catch (cause) {
      roomRef.current?.disconnect();
      roomRef.current = null;
      analyserRef.current = null;
      setCallState("error");
      setError(cause instanceof Error ? cause.message : "Call failed.");
    }
  }

  function endCall() {
    callAttemptRef.current += 1;

    const ringtone = ringtoneRef.current;
    if (ringtone) {
      ringtone.pause();
      ringtone.currentTime = 0;
    }

    roomRef.current?.disconnect();
    roomRef.current = null;
    analyserRef.current = null;
    audioHostRef.current?.replaceChildren();
    setMuted(false);
    setCallState("idle");
  }

  async function toggleMute() {
    if (!roomRef.current || !isLive) return;
    const next = !muted;
    await roomRef.current.localParticipant.setMicrophoneEnabled(!next);
    setMuted(next);
  }

  function toggleSpeaker() {
    const next = !speaker;
    setSpeaker(next);
    audioHostRef.current
      ?.querySelectorAll<HTMLMediaElement>("[data-abbie-audio]")
      .forEach((element) => {
        element.muted = !next;
      });
  }

  return (
    <main className="min-h-dvh bg-black text-white sm:grid sm:place-items-center sm:bg-[#111318] sm:p-6">
      <div ref={audioHostRef} className="hidden" aria-hidden="true" />

      <section className="relative min-h-dvh w-full overflow-hidden bg-[#0a0b10] sm:min-h-[860px] sm:max-w-[430px] sm:rounded-[42px] sm:border-[8px] sm:border-black sm:shadow-[0_45px_120px_rgba(0,0,0,.65)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(38,48,88,.55),transparent_30%),radial-gradient(circle_at_82%_72%,rgba(102,58,105,.44),transparent_34%),radial-gradient(circle_at_50%_100%,rgba(185,117,82,.28),transparent_30%),linear-gradient(180deg,#07080c_0%,#11131e_42%,#282536_100%)]" />
        <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" />

        <div className="relative z-10 flex min-h-dvh flex-col px-7 pb-[max(28px,env(safe-area-inset-bottom))] pt-[max(18px,env(safe-area-inset-top))] sm:min-h-[844px]">
          <div className="flex items-center justify-between text-[14px] font-medium text-white/90">
            <span>{localTime()}</span>
            <div className="flex items-center gap-2 text-[11px] text-white/80">
              <span className="tracking-[-2px]">▮▮▮▮</span>
              <span className="font-semibold">5G</span>
              <span className="rounded-[5px] border border-white/50 px-1.5 py-[1px] font-semibold">31</span>
            </div>
          </div>

          <div className="mt-8 flex items-center justify-center gap-2 text-[14px] font-medium text-white/65" role="status" aria-live="polite" aria-atomic="true">
            <span className="rounded-[4px] bg-white/90 px-1.5 py-0.5 text-[10px] font-black text-[#20232a]">HD</span>
            <span>{statusText}</span>
            <Video className="ml-2 size-4 text-white/45" />
          </div>

          <div className="mt-12 flex flex-col items-center text-center">
            <div className="grid size-[116px] place-items-center rounded-full border border-white/10 bg-gradient-to-br from-[#39445f] to-[#171922] shadow-[0_20px_60px_rgba(0,0,0,.35)]">
              <div className="grid size-[104px] place-items-center rounded-full bg-white/[0.08]">
                <Headphones className="size-12 text-white/92" strokeWidth={1.6} />
              </div>
            </div>

            <h1 className="mt-7 text-[38px] font-medium tracking-[-0.035em] text-white">
              {CONTACT_NAME}
            </h1>
            <p className="mt-1 text-[15px] text-white/50">{CONTACT_SUBTITLE}</p>

            <input
              value={number}
              onChange={(event) => setNumber(event.target.value)}
              disabled={isBusy}
              inputMode="tel"
              aria-label="Phone number"
              className="mt-3 w-full border-0 bg-transparent text-center text-[17px] font-normal tracking-[.02em] text-white/70 outline-none disabled:opacity-100"
            />
            <p className="mt-1 text-[13px] text-white/35">Philippines</p>
          </div>

          <div className="mt-8 flex h-16 items-center justify-center gap-[5px]" aria-label="Call audio visualizer">
            {levels.map((level, index) => (
              <span
                key={index}
                className={cx(
                  "w-[4px] rounded-full transition-[height,opacity] duration-75",
                  isLive
                    ? "bg-white/90"
                    : isRinging || isConnecting
                      ? "bg-white/30"
                      : "bg-white/10",
                )}
                style={{
                  height: (8 + level * 42) + "px",
                  opacity: isLive ? 0.62 + level * 0.38 : 0.55,
                }}
              />
            ))}
          </div>

          <div className="mt-auto grid grid-cols-3 gap-x-7 gap-y-8">
            <CallControl
              icon={<Plus className="size-8" strokeWidth={1.8} />}
              label="Add call"
              disabled
            />
            <CallControl
              icon={muted
                ? <MicOff className="size-8" strokeWidth={1.8} />
                : <Mic className="size-8" strokeWidth={1.8} />}
              label={muted ? "Unmute" : "Mute"}
              active={muted}
              onClick={toggleMute}
              disabled={!isLive}
            />
            <CallControl
              icon={<Bluetooth className="size-8" strokeWidth={1.8} />}
              label="Bluetooth"
            />

            <CallControl
              icon={speaker
                ? <Volume2 className="size-8" strokeWidth={1.8} />
                : <VolumeX className="size-8" strokeWidth={1.8} />}
              label="Speaker"
              active={speaker && isLive}
              onClick={toggleSpeaker}
              disabled={!isLive}
            />
            <CallControl icon={<DialpadDots />} label="Keypad" />
            <CallControl
              icon={<EllipsisVertical className="size-8" strokeWidth={2} />}
              label="More"
            />
          </div>

          <div className="mt-11 flex flex-col items-center">
            {isBusy ? (
              <button
                type="button"
                onClick={endCall}
                className="grid size-[84px] place-items-center rounded-full bg-[#ef3f38] shadow-[0_18px_45px_rgba(239,63,56,.28)] transition active:scale-95"
                aria-label="End call"
              >
                <PhoneOff className="size-9 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={startCall}
                className="grid size-[84px] place-items-center rounded-full bg-[#32c66c] shadow-[0_18px_45px_rgba(50,198,108,.24)] transition active:scale-95"
                aria-label="Call Abitech CSR"
              >
                <Phone className="size-9 fill-current" />
              </button>
            )}

            {error ? (
              <p className="mt-4 max-w-[300px] rounded-xl bg-black/30 px-4 py-2 text-center text-xs text-red-100 ring-1 ring-red-300/15">
                {error}
              </p>
            ) : (
              <p className="mt-4 text-xs text-white/35" role="status" aria-live="polite" aria-atomic="true">
                {isLive
                  ? "Connected · Abbie is on the line"
                  : isRinging
                    ? "Ringing Abitech CSR…"
                    : isConnecting
                      ? "Answering…"
                      : "Tap to call"}
              </p>
            )}
          </div>

          <div className="mt-8 flex items-end justify-between px-10 text-white/75 sm:hidden">
            <span className="text-[24px] tracking-[-7px]">|||</span>
            <span className="size-7 rounded-full border-[2px] border-white/70" />
            <span className="text-[48px] font-light leading-[.65]">‹</span>
          </div>
        </div>
      </section>
    </main>
  );
}

function CallControl({
  icon,
  label,
  active = false,
  disabled = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={cx(
        "flex flex-col items-center transition",
        disabled && "opacity-35",
      )}
    >
      <span
        className={cx(
          "grid size-[78px] place-items-center rounded-[26px] border border-white/[0.05] text-white shadow-[inset_0_1px_0_rgba(255,255,255,.04)] transition active:scale-95",
          active ? "bg-white/[0.22]" : "bg-black/[0.26]",
        )}
      >
        {icon}
      </span>
      <span className="mt-2.5 text-[14px] font-normal text-white/90">{label}</span>
    </button>
  );
}

function DialpadDots() {
  return (
    <span className="grid grid-cols-3 gap-[5px]">
      {Array.from({ length: 12 }).map((_, index) => (
        <i
          key={index}
          className={cx(
            "size-[5px] rounded-full",
            index === 9 || index === 11 ? "bg-transparent" : "bg-current",
          )}
        />
      ))}
    </span>
  );
}
