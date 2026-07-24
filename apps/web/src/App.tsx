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
  hand: number;
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
  blink: 0,
  hand: 0.25
};

export function App() {
  const [mode, setMode] = useState<GenerationMode>("image");
  const [prompt, setPrompt] = useState("Create a cinematic studio portrait for a consent-based AI avatar profile.");
  const [voiceOptions, setVoiceOptions] = useState<VoiceOptions>(defaultVoiceOptions);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState("");
  const [recordedAudioName, setRecordedAudioName] = useState("");
  const [micError, setMicError] = useState("");
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [latencyMs, setLatencyMs] = useState(450);
  const [avatarStyle, setAvatarStyle] = useState("cinematic");
  const [fictionalIdentity, setFictionalIdentity] = useState("generated");
  const [expression, setExpression] = useState("natural");
  const [handGesture, setHandGesture] = useState("idle");
  const [referenceImage, setReferenceImage] = useState("");
  const [cameraDrivenGestures, setCameraDrivenGestures] = useState(true);
  const [trackingStrength, setTrackingStrength] = useState(0);
  const [motion, setMotion] = useState<MotionState>(defaultMotion);
  const [delayedMotion, setDelayedMotion] = useState<MotionState>(defaultMotion);
  const [consentConfirmed, setConsentConfirmed] = useState(true);
  const [generations, setGenerations] = useState<Generation[]>(samples);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const previousFrameRef = useRef<Uint8ClampedArray | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

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
    if (!liveEnabled || !cameraDrivenGestures) {
      previousFrameRef.current = null;
      return;
    }

    animationFrameRef.current = window.requestAnimationFrame(trackCameraMotion);

    return () => {
      if (animationFrameRef.current) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [cameraDrivenGestures, expression, handGesture, liveEnabled]);

  useEffect(() => {
    return () => stopCamera();
  }, []);

  useEffect(() => {
    if (!isRecording) {
      return;
    }

    const timer = window.setInterval(() => setRecordingSeconds((current) => current + 1), 1000);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  useEffect(() => {
    return () => {
      stopMicrophone();

      if (recordedAudioUrl) {
        URL.revokeObjectURL(recordedAudioUrl);
      }
    };
  }, [recordedAudioUrl]);

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

  async function startMicrophoneRecording() {
    setMicError("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioStreamRef.current = stream;
      audioChunksRef.current = [];
      mediaRecorderRef.current = recorder;

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      });

      recorder.addEventListener("stop", () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const audioUrl = URL.createObjectURL(audioBlob);

        if (recordedAudioUrl) {
          URL.revokeObjectURL(recordedAudioUrl);
        }

        setRecordedAudioUrl(audioUrl);
        setRecordedAudioName(`voice-recording-${new Date().toISOString().slice(11, 19).replaceAll(":", "-")}.webm`);
        setPrompt(`Translate my recorded voice to ${voiceOptions.targetLanguage} and preserve my ${voiceOptions.emotion.toLowerCase()} emotion.`);
        stopMicrophone();
      });

      setRecordingSeconds(0);
      setIsRecording(true);
      recorder.start();
    } catch {
      setMicError("Microphone permission is needed to record your voice.");
      setIsRecording(false);
    }
  }

  function stopMicrophone() {
    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    audioStreamRef.current = null;
  }

  function stopMicrophoneRecording() {
    const recorder = mediaRecorderRef.current;

    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }

    setIsRecording(false);
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
    if (animationFrameRef.current) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    previousFrameRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setLiveEnabled(false);
    setTrackingStrength(0);
  }

  function trackCameraMotion() {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas || video.readyState < 2) {
      animationFrameRef.current = window.requestAnimationFrame(trackCameraMotion);
      return;
    }

    const width = 96;
    const height = 72;
    const context = canvas.getContext("2d", { willReadFrequently: true });

    if (!context) {
      return;
    }

    canvas.width = width;
    canvas.height = height;
    context.drawImage(video, 0, 0, width, height);

    const frame = context.getImageData(0, 0, width, height).data;
    const previous = previousFrameRef.current;

    if (previous) {
      let total = 0;
      let weightedX = 0;
      let weightedY = 0;

      for (let index = 0; index < frame.length; index += 16) {
        const pixel = index / 4;
        const x = pixel % width;
        const y = Math.floor(pixel / width);
        const diff =
          Math.abs(frame[index] - previous[index]) +
          Math.abs(frame[index + 1] - previous[index + 1]) +
          Math.abs(frame[index + 2] - previous[index + 2]);

        if (diff > 54) {
          total += diff;
          weightedX += x * diff;
          weightedY += y * diff;
        }
      }

      if (total > 0) {
        const centerX = weightedX / total;
        const centerY = weightedY / total;
        const x = (centerX / width - 0.5) * -2;
        const y = (centerY / height - 0.5) * 2;
        const strength = Math.min(1, total / 540000);
        const expressionBoost = expression === "smile" ? 0.34 : expression === "serious" ? -0.18 : 0;
        const cameraHand = centerY < height * 0.45 && strength > 0.18 ? 0.96 : Math.max(0.18, strength * 1.4);

        setTrackingStrength(strength);
        setMotion({
          x: Math.max(-1, Math.min(1, x)),
          y: Math.max(-1, Math.min(1, y)),
          smile: Math.max(0.12, Math.min(0.95, 0.42 + expressionBoost + strength * 0.3)),
          blink: expression === "blink" ? 1 : Math.max(0, Math.sin(Date.now() / 700) > 0.965 ? 1 : 0),
          hand: handGesture === "wave" ? 0.95 : handGesture === "point" ? 0.72 : cameraHand
        });
      }
    }

    previousFrameRef.current = new Uint8ClampedArray(frame);
    animationFrameRef.current = window.requestAnimationFrame(trackCameraMotion);
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
      blink: expression === "blink" ? 1 : Math.max(0, Math.sin(Date.now() / 700) > 0.96 ? 1 : 0),
      hand: handGesture === "wave" ? 0.95 : handGesture === "point" ? 0.7 : Math.max(0.12, Math.min(0.85, 0.3 - y * 0.25))
    });
  }

  function loadReferenceImage(file: File | undefined) {
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      setReferenceImage(typeof reader.result === "string" ? reader.result : "");
    });
    reader.readAsDataURL(file);
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
                <div className={isRecording ? "mic-panel recording" : "mic-panel"}>
                  <div className="mic-meter" aria-hidden="true">
                    {Array.from({ length: 24 }).map((_, index) => (
                      <span key={index} style={{ animationDelay: `${index * 38}ms` }} />
                    ))}
                  </div>
                  <div className="mic-copy">
                    <strong>{isRecording ? "Recording microphone" : recordedAudioUrl ? "Recording ready" : "Microphone input"}</strong>
                    <span>
                      {isRecording
                        ? `${recordingSeconds}s captured`
                        : recordedAudioName || "Record your voice, then translate or transform it."}
                    </span>
                  </div>
                  <button
                    className={isRecording ? "record-action active" : "record-action"}
                    onClick={isRecording ? stopMicrophoneRecording : startMicrophoneRecording}
                    type="button"
                  >
                    <Mic2 size={17} />
                    {isRecording ? "Stop" : "Record"}
                  </button>
                </div>

                {recordedAudioUrl && (
                  <div className="audio-playback">
                    <audio controls src={recordedAudioUrl} />
                    <small>Local preview only. The next backend step is uploading this blob to private storage.</small>
                  </div>
                )}

                {micError && <p className="error-message">{micError}</p>}

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
                <label className="reference-upload">
                  <input accept="image/*" onChange={(event) => loadReferenceImage(event.target.files?.[0])} type="file" />
                  <div className="reference-preview">
                    {referenceImage ? <img alt="Fictional avatar reference" src={referenceImage} /> : <ImagePlus size={24} />}
                  </div>
                  <span>Upload fictional or AI-generated avatar reference</span>
                  <small>No celebrity or private-person impersonation.</small>
                </label>

                <div
                  className="camera-stage"
                  onPointerMove={(event) => updateMotionFromPointer(event.clientX, event.clientY, event.currentTarget)}
                >
                  <video autoPlay muted playsInline ref={videoRef} />
                  <canvas className="tracking-canvas" ref={canvasRef} />
                  {!liveEnabled && (
                    <div className="camera-empty">
                      <Camera size={28} />
                      <span>Camera preview</span>
                    </div>
                  )}
                  <div className="tracking-hud">
                    <span>
                      <Radio size={14} />
                      {liveEnabled ? (cameraDrivenGestures ? "camera tracking" : "manual tracking") : "standby"}
                    </span>
                    <span>{Math.round(trackingStrength * 100)}% motion</span>
                  </div>
                </div>

                <div className="control-grid">
                  <label className="toggle-row realtime-toggle">
                    <input
                      checked={cameraDrivenGestures}
                      onChange={(event) => setCameraDrivenGestures(event.target.checked)}
                      type="checkbox"
                    />
                    Drive avatar from camera motion
                  </label>

                  <label className="field">
                    Identity source
                    <select value={fictionalIdentity} onChange={(event) => setFictionalIdentity(event.target.value)}>
                      <option value="generated">AI-generated character</option>
                      <option value="uploaded">Uploaded fictional reference</option>
                      <option value="licensed">Licensed actor reference</option>
                    </select>
                  </label>

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

                  <label className="field">
                    Hand gesture
                    <select value={handGesture} onChange={(event) => setHandGesture(event.target.value)}>
                      <option value="idle">Idle hands</option>
                      <option value="wave">Wave</option>
                      <option value="point">Point</option>
                      <option value="follow">Follow camera area</option>
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
                  <button className="secondary-action" onClick={() => setHandGesture("wave")} type="button">
                    <Radio size={17} />
                    Test hand
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
                  {referenceImage && fictionalIdentity === "uploaded" && (
                    <img alt="Fictional reference influence" className="reference-backplate" src={referenceImage} />
                  )}
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
                  <div
                    className={`avatar-hand ${handGesture}`}
                    style={{
                      transform: `translate(${delayedMotion.x * 24}px, ${80 - delayedMotion.hand * 120}px) rotate(${
                        handGesture === "wave" ? -22 + delayedMotion.x * 18 : handGesture === "point" ? -42 : -10
                      }deg)`
                    }}
                  >
                    <span />
                  </div>
                  <div className="avatar-shadow" />
                </div>

                <div className="signal-strip">
                  <span>Head X {delayedMotion.x.toFixed(2)}</span>
                  <span>Head Y {delayedMotion.y.toFixed(2)}</span>
                  <span>Smile {delayedMotion.smile.toFixed(2)}</span>
                  <span>Hand {delayedMotion.hand.toFixed(2)}</span>
                </div>

                <div className="pipeline-steps">
                  <span className={liveEnabled ? "done" : ""}>camera</span>
                  <span className={liveEnabled ? "done" : ""}>gesture map</span>
                  <span className={referenceImage ? "done" : ""}>{fictionalIdentity}</span>
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
