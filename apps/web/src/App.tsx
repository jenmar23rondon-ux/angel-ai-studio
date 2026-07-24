import {
  Activity,
  Camera,
  ImagePlus,
  Images,
  Mic2,
  Radio,
  ScanFace,
  ShieldCheck,
  Sparkles,
  Video
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createGeneration, Generation, GenerationMode, listGenerations, VoiceOptions } from "./services/api";

type MotionState = {
  x: number;
  y: number;
  smile: number;
  blink: number;
};

const modes: Array<{ id: GenerationMode; label: string; icon: LucideIcon }> = [
  { id: "image", label: "Text to image", icon: Sparkles },
  { id: "edit", label: "Edit image", icon: ImagePlus },
  { id: "avatar", label: "Avatar", icon: ShieldCheck },
  { id: "video", label: "Image to video", icon: Video },
  { id: "audio", label: "Voice Studio", icon: Mic2 },
  { id: "realtime", label: "Real-time face", icon: ScanFace }
];

const samples: Generation[] = [
  {
    id: "demo-1",
    type: "image",
    prompt: "Editorial product portrait with clean light and deep teal background",
    status: "completed",
    outputUrl:
      "https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=900&q=80",
    createdAt: new Date().toISOString()
  },
  {
    id: "demo-2",
    type: "audio",
    prompt: "Convert my recorded Spanish audio to English while preserving tone and emotion",
    status: "processing",
    metadata: {
      voiceMode: "translation",
      targetLanguage: "English",
      accent: "Neutral US"
    },
    createdAt: new Date(Date.now() - 1000 * 60 * 7).toISOString()
  }
];

const defaultVoiceOptions: VoiceOptions = {
  voiceMode: "voice-conversion",
  targetVoice: "Designed studio voice",
  accent: "Neutral US",
  targetLanguage: "English",
  emotion: "Natural",
  preserveEmotion: true,
  removeNoise: true
};

const defaultMotion: MotionState = {
  x: 0,
  y: 0,
  smile: 0.45,
  blink: 0
};

export function App() {
  const [mode, setMode] = useState<GenerationMode>("image");
  const [prompt, setPrompt] = useState("Create a cinematic studio portrait for a consent-based AI avatar profile.");
  const [voiceOptions, setVoiceOptions] = useState<VoiceOptions>(defaultVoiceOptions);
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [latencyMs, setLatencyMs] = useState(450);
  const [avatarStyle, setAvatarStyle] = useState("cinematic");
  const [expression, setExpression] = useState("natural");
  const [motion, setMotion] = useState<MotionState>(defaultMotion);
  const [delayedMotion, setDelayedMotion] = useState<MotionState>(defaultMotion);
  const [consentConfirmed, setConsentConfirmed] = useState(true);
  const [generations, setGenerations] = useState<Generation[]>(samples);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    listGenerations()
      .then((items) => items.length && setGenerations(items))
      .catch(() => {
        setGenerations(samples);
      });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDelayedMotion(motion), latencyMs);
    return () => window.clearTimeout(timer);
  }, [latencyMs, motion]);

  useEffect(() => {
    if (mode !== "realtime") {
      stopCamera();
    }
  }, [mode]);

  useEffect(() => {
    return () => stopCamera();
  }, []);

  const stats = useMemo(
    () => ({
      completed: generations.filter((item) => item.status === "completed").length,
      queued: generations.filter((item) => item.status === "queued" || item.status === "processing").length
    }),
    [generations]
  );

  async function submitGeneration() {
    setError("");
    setIsSubmitting(true);

    try {
      const generation = await createGeneration({
        type: mode,
        prompt,
        consentConfirmed,
        voiceOptions: mode === "audio" ? voiceOptions : undefined
      });
      setGenerations((current) => [generation, ...current.filter((item) => !item.id.startsWith("demo-"))]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Generation failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  function updateVoiceOption<Key extends keyof VoiceOptions>(key: Key, value: VoiceOptions[Key]) {
    setVoiceOptions((current) => ({ ...current, [key]: value }));
  }

  async function startCamera() {
    setCameraError("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      setLiveEnabled(true);
    } catch {
      setCameraError("Camera permission is needed for the real-time preview.");
      setLiveEnabled(false);
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setLiveEnabled(false);
  }

  function updateMotionFromPointer(clientX: number, clientY: number, target: HTMLElement) {
    const rect = target.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width - 0.5) * 2;
    const y = ((clientY - rect.top) / rect.height - 0.5) * 2;
    const expressionBoost = expression === "smile" ? 0.35 : expression === "serious" ? -0.18 : 0;

    setMotion({
      x: Math.max(-1, Math.min(1, x)),
      y: Math.max(-1, Math.min(1, y)),
      smile: Math.max(0.12, Math.min(0.95, 0.45 + expressionBoost - y * 0.12)),
      blink: expression === "blink" ? 1 : Math.max(0, Math.sin(Date.now() / 700) > 0.96 ? 1 : 0)
    });
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">a</div>
          <div>
            <strong>angel-ai-studio</strong>
            <span>AI media and voice studio</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="Primary">
          {modes.map((item) => {
            const Icon = item.icon;
            return (
              <button className={mode === item.id ? "active" : ""} key={item.id} onClick={() => setMode(item.id)}>
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="safety-note">
          <ShieldCheck size={18} />
          <p>Consent checks, private files, signed URLs, audit logs and abuse prevention are first-class paths.</p>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>Generation workspace</h1>
            <p>Build images, avatars, edits, videos, voices and live face previews through one guarded pipeline.</p>
          </div>
          <div className="status-pills">
            <span>
              <Activity size={16} />
              {stats.queued} active
            </span>
            <span>
              <Images size={16} />
              {stats.completed} ready
            </span>
          </div>
        </header>

        <section className="generator-layout">
          <div className="creator-panel">
            <div className="panel-header">
              <h2>{modes.find((item) => item.id === mode)?.label}</h2>
              <span>{mode === "realtime" ? `${latencyMs}ms preview delay` : "Provider: mock adapter"}</span>
            </div>

            {mode !== "realtime" && (
              <label className="field">
                {mode === "audio" ? "Voice task" : "Prompt"}
                <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={7} />
              </label>
            )}

            {mode === "audio" && (
              <div className="voice-controls">
                <label className="field">
                  Mode
                  <select
                    value={voiceOptions.voiceMode}
                    onChange={(event) => updateVoiceOption("voiceMode", event.target.value as VoiceOptions["voiceMode"])}
                  >
                    <option value="voice-conversion">Change voice, keep words</option>
                    <option value="accent">Change accent</option>
                    <option value="translation">Translate with voice</option>
                  </select>
                </label>

                <label className="field">
                  Target voice
                  <select
                    value={voiceOptions.targetVoice}
                    onChange={(event) => updateVoiceOption("targetVoice", event.target.value)}
                  >
                    <option>Designed studio voice</option>
                    <option>My cloned voice</option>
                    <option>Warm narrator</option>
                    <option>Clear assistant</option>
                  </select>
                </label>

                <label className="field">
                  Accent
                  <select value={voiceOptions.accent} onChange={(event) => updateVoiceOption("accent", event.target.value)}>
                    <option>Neutral US</option>
                    <option>British</option>
                    <option>Mexican Spanish</option>
                    <option>Colombian Spanish</option>
                    <option>Brazilian Portuguese</option>
                  </select>
                </label>

                <label className="field">
                  Language
                  <select
                    value={voiceOptions.targetLanguage}
                    onChange={(event) => updateVoiceOption("targetLanguage", event.target.value)}
                  >
                    <option>English</option>
                    <option>Spanish</option>
                    <option>Portuguese</option>
                    <option>French</option>
                  </select>
                </label>

                <label className="field">
                  Emotion
                  <select value={voiceOptions.emotion} onChange={(event) => updateVoiceOption("emotion", event.target.value)}>
                    <option>Natural</option>
                    <option>Calm</option>
                    <option>Energetic</option>
                    <option>Serious</option>
                  </select>
                </label>

                <label className="toggle-row">
                  <input
                    checked={voiceOptions.preserveEmotion}
                    onChange={(event) => updateVoiceOption("preserveEmotion", event.target.checked)}
                    type="checkbox"
                  />
                  Preserve rhythm and emotion
                </label>

                <label className="toggle-row">
                  <input
                    checked={voiceOptions.removeNoise}
                    onChange={(event) => updateVoiceOption("removeNoise", event.target.checked)}
                    type="checkbox"
                  />
                  Remove background noise first
                </label>
              </div>
            )}

            {mode === "realtime" && (
              <div className="realtime-controls">
                <div
                  className="camera-stage"
                  onPointerMove={(event) => updateMotionFromPointer(event.clientX, event.clientY, event.currentTarget)}
                >
                  <video autoPlay muted playsInline ref={videoRef} />
                  {!liveEnabled && (
                    <div className="camera-empty">
                      <Camera size={28} />
                      <span>Camera preview</span>
                    </div>
                  )}
                  <div className="tracking-hud">
                    <span>
                      <Radio size={14} />
                      {liveEnabled ? "tracking" : "standby"}
                    </span>
                    <span>gesture input</span>
                  </div>
                </div>

                <div className="control-grid">
                  <label className="field">
                    AI face style
                    <select value={avatarStyle} onChange={(event) => setAvatarStyle(event.target.value)}>
                      <option value="cinematic">Cinematic avatar</option>
                      <option value="anime">Animated creator</option>
                      <option value="studio">Studio presenter</option>
                      <option value="robotic">Synthetic assistant</option>
                    </select>
                  </label>

                  <label className="field">
                    Expression
                    <select value={expression} onChange={(event) => setExpression(event.target.value)}>
                      <option value="natural">Natural</option>
                      <option value="smile">Smile</option>
                      <option value="serious">Serious</option>
                      <option value="blink">Blink test</option>
                    </select>
                  </label>

                  <label className="field range-field">
                    Delay: {latencyMs}ms
                    <input
                      max="1200"
                      min="120"
                      onChange={(event) => setLatencyMs(Number(event.target.value))}
                      step="30"
                      type="range"
                      value={latencyMs}
                    />
                  </label>
                </div>

                {cameraError && <p className="error-message">{cameraError}</p>}

                <div className="button-row">
                  <button className="secondary-action" onClick={liveEnabled ? stopCamera : startCamera} type="button">
                    <Camera size={17} />
                    {liveEnabled ? "Stop camera" : "Start camera"}
                  </button>
                  <button className="secondary-action" onClick={() => setExpression("smile")} type="button">
                    <ScanFace size={17} />
                    Test smile
                  </button>
                </div>
              </div>
            )}

            <div className="upload-slot">
              {mode === "audio" ? <Mic2 size={22} /> : mode === "realtime" ? <ScanFace size={22} /> : <ImagePlus size={22} />}
              <span>
                {mode === "audio"
                  ? "Drop audio file or record from the browser"
                  : mode === "realtime"
                    ? "Real-time sessions can be recorded or streamed later"
                    : "Drop source image or training photos here"}
              </span>
              <small>
                {mode === "audio"
                  ? "Audio upload and recording flow is scaffolded for MP3/WAV."
                  : mode === "realtime"
                    ? "This preview uses browser camera input and a delayed avatar render."
                    : "Upload endpoint is scaffolded for S3 signed URLs."}
              </small>
            </div>

            <label className="consent-row">
              <input
                checked={consentConfirmed}
                onChange={(event) => setConsentConfirmed(event.target.checked)}
                type="checkbox"
              />
              I confirm I have rights and consent for all source media, faces and voices.
            </label>

            {error && <p className="error-message">{error}</p>}

            <button className="primary-action" disabled={isSubmitting || !prompt.trim()} onClick={submitGeneration}>
              <Sparkles size={18} />
              {isSubmitting
                ? "Queuing..."
                : mode === "audio"
                  ? "Create voice job"
                  : mode === "realtime"
                    ? "Save live session"
                    : "Create generation"}
            </button>
          </div>

          <div className={mode === "realtime" ? "gallery-panel realtime-panel" : "gallery-panel"}>
            <div className="panel-header">
              <h2>{mode === "realtime" ? "AI face output" : "Private gallery"}</h2>
              <span>{mode === "realtime" ? "live preview" : `${generations.length} items`}</span>
            </div>

            {mode === "realtime" ? (
              <div className="avatar-output">
                <div className={`ai-face ${avatarStyle}`}>
                  <div
                    className="face-head"
                    style={{
                      transform: `rotateX(${delayedMotion.y * -8}deg) rotateY(${delayedMotion.x * 12}deg)`
                    }}
                  >
                    <div className="hairline" />
                    <div className="eyes" style={{ transform: `translateX(${delayedMotion.x * 10}px)` }}>
                      <span style={{ transform: `scaleY(${delayedMotion.blink ? 0.12 : 1})` }} />
                      <span style={{ transform: `scaleY(${delayedMotion.blink ? 0.12 : 1})` }} />
                    </div>
                    <div className="nose" />
                    <div
                      className="mouth"
                      style={{
                        borderRadius: `${20 + delayedMotion.smile * 30}px ${20 + delayedMotion.smile * 30}px 70px 70px`,
                        height: `${8 + delayedMotion.smile * 18}px`
                      }}
                    />
                  </div>
                  <div className="avatar-shadow" />
                </div>

                <div className="signal-strip">
                  <span>Head X {delayedMotion.x.toFixed(2)}</span>
                  <span>Head Y {delayedMotion.y.toFixed(2)}</span>
                  <span>Smile {delayedMotion.smile.toFixed(2)}</span>
                </div>

                <div className="pipeline-steps">
                  <span className={liveEnabled ? "done" : ""}>camera</span>
                  <span className={liveEnabled ? "done" : ""}>gesture map</span>
                  <span>AI face render</span>
                  <span>stream output</span>
                </div>
              </div>
            ) : (
              <div className="gallery-grid">
                {generations.map((item) => (
                  <article className="asset-card" key={item.id}>
                    {item.outputUrl ? (
                      <img alt={item.prompt} src={item.outputUrl} />
                    ) : (
                      <div className="asset-placeholder">
                        <Sparkles size={24} />
                      </div>
                    )}
                    <div>
                      <strong>{item.type}</strong>
                      <span className={`status ${item.status}`}>{item.status}</span>
                    </div>
                    <p>{item.prompt}</p>
                    {item.type === "audio" && item.metadata && (
                      <small className="asset-meta">
                        {String(item.metadata.voiceMode ?? "voice")} - {String(item.metadata.targetLanguage ?? "same language")} -{" "}
                        {String(item.metadata.accent ?? "native accent")}
                      </small>
                    )}
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
