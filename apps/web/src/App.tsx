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
  mouth: number;
  touchX: number;
  touchY: number;
};

type LandmarkPoint = {
  x: number;
  y: number;
  z?: number;
};

type BlendshapeCategory = {
  categoryName: string;
  score: number;
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
  hand: 0.25,
  mouth: 0.12,
  touchX: 0.38,
  touchY: -0.15
};

const clamp = (value: number, min = -1, max = 1) => Math.max(min, Math.min(max, value));
const mediapipeVersion = "0.10.35";

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
  const [latencyMs] = useState(0);
  const [avatarStyle, setAvatarStyle] = useState("photo");
  const [puppetZoom, setPuppetZoom] = useState(1.08);
  const [motionIntensity, setMotionIntensity] = useState(1.35);
  const [fictionalIdentity, setFictionalIdentity] = useState("generated");
  const [expression, setExpression] = useState("natural");
  const [handGesture, setHandGesture] = useState("idle");
  const [referenceImage, setReferenceImage] = useState("");
  const [cameraDrivenGestures, setCameraDrivenGestures] = useState(true);
  const [trackingStrength, setTrackingStrength] = useState(0);
  const [trackingMode, setTrackingMode] = useState<"landmarks" | "motion">("landmarks");
  const [trackingReady, setTrackingReady] = useState(false);
  const [trackingLabel, setTrackingLabel] = useState("landmark engine idle");
  const [faceConfidence, setFaceConfidence] = useState(0);
  const [handConfidence, setHandConfidence] = useState(0);
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
  const faceLandmarkerRef = useRef<any>(null);
  const handLandmarkerRef = useRef<any>(null);
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
    if (latencyMs === 0) {
      setDelayedMotion(motion);
      return;
    }

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

    animationFrameRef.current = window.requestAnimationFrame(trackCameraFrame);

    return () => {
      if (animationFrameRef.current) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [cameraDrivenGestures, expression, handGesture, liveEnabled, trackingMode, trackingReady]);

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
    setTrackingLabel("requesting camera");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      if (trackingMode === "landmarks") {
        await initializeLandmarkTracking();
      }

      setLiveEnabled(true);
    } catch {
      setCameraError("Camera permission is needed for the real-time preview.");
      setTrackingLabel("camera blocked");
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
    setFaceConfidence(0);
    setHandConfidence(0);
    setTrackingLabel(trackingReady ? "landmark engine ready" : "landmark engine idle");
  }

  async function initializeLandmarkTracking() {
    if (faceLandmarkerRef.current && handLandmarkerRef.current) {
      setTrackingReady(true);
      setTrackingLabel("landmark tracking");
      return true;
    }

    try {
      setTrackingLabel("loading face and hand tracker");
      const { FaceLandmarker, FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${mediapipeVersion}/wasm`);

      faceLandmarkerRef.current = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task"
        },
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
        runningMode: "VIDEO"
      });

      handLandmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task"
        },
        numHands: 2,
        runningMode: "VIDEO"
      });

      setTrackingReady(true);
      setTrackingLabel("landmark tracking");
      return true;
    } catch {
      setTrackingMode("motion");
      setTrackingReady(false);
      setTrackingLabel("motion fallback");
      return false;
    }
  }

  function trackCameraFrame() {
    if (trackingMode === "landmarks" && trackingReady && faceLandmarkerRef.current) {
      trackLandmarkFrame();
      animationFrameRef.current = window.requestAnimationFrame(trackCameraFrame);
      return;
    }

    trackCameraMotionFallback();
    animationFrameRef.current = window.requestAnimationFrame(trackCameraFrame);
  }

  function trackLandmarkFrame() {
    const video = videoRef.current;

    if (!video || video.readyState < 2) {
      return;
    }

    const now = performance.now();
    const faceResult = faceLandmarkerRef.current.detectForVideo(video, now);
    const handResult = handLandmarkerRef.current?.detectForVideo(video, now);
    const faceLandmarks = faceResult.faceLandmarks?.[0] as LandmarkPoint[] | undefined;
    const handLandmarks = handResult?.landmarks?.[0] as LandmarkPoint[] | undefined;
    const categories = (faceResult.faceBlendshapes?.[0]?.categories ?? []) as BlendshapeCategory[];
    const score = (name: string) => categories.find((item) => item.categoryName === name)?.score ?? 0;

    const expressionBoost = expression === "smile" ? 0.28 : expression === "serious" ? -0.16 : 0;
    let nextMotion = motion;
    let faceScore = 0;
    let handScore = Math.max(0, motion.hand * 0.86);

    if (faceLandmarks) {
      const nose = faceLandmarks[1] ?? faceLandmarks[4] ?? faceLandmarks[0];
      const mouthTop = faceLandmarks[13];
      const mouthBottom = faceLandmarks[14];
      const mouthDistance = mouthTop && mouthBottom ? clamp((mouthBottom.y - mouthTop.y) * 18, 0, 1) : 0;
      const smileScore = Math.max(score("mouthSmileLeft"), score("mouthSmileRight"), score("mouthDimpleLeft"));
      const blinkScore = Math.max(score("eyeBlinkLeft"), score("eyeBlinkRight"));

      faceScore = 1;
      nextMotion = {
        ...nextMotion,
        x: clamp((0.5 - nose.x) * 2.6),
        y: clamp((nose.y - 0.44) * 2.4),
        smile: clamp(0.2 + smileScore * 0.9 + mouthDistance * 0.35 + expressionBoost, 0.08, 1),
        blink: expression === "blink" ? 1 : clamp(blinkScore * 1.4, 0, 1),
        mouth: clamp(mouthDistance + score("jawOpen") * 0.7, 0, 1)
      };
    }

    if (handLandmarks) {
      const wrist = handLandmarks[0];
      const indexTip = handLandmarks[8] ?? wrist;
      const middleTip = handLandmarks[12] ?? indexTip;
      const highestFinger = Math.min(indexTip.y, middleTip.y, wrist.y);
      handScore = clamp((0.82 - highestFinger) * 2.4, 0.1, 1);
      nextMotion = {
        ...nextMotion,
        hand: handGesture === "wave" ? Math.max(0.92, handScore) : handGesture === "point" ? 0.86 : handScore,
        touchX: clamp((0.5 - indexTip.x) * 2),
        touchY: clamp((indexTip.y - 0.5) * 2)
      };
    } else {
      nextMotion = {
        ...nextMotion,
        hand: handGesture === "wave" ? 0.92 : handGesture === "point" ? 0.78 : Math.max(0.05, nextMotion.hand * 0.9)
      };
    }

    setFaceConfidence(faceScore);
    setHandConfidence(handLandmarks ? handScore : 0);
    setTrackingStrength(clamp(faceScore * 0.72 + handScore * 0.28, 0, 1));
    setMotion(nextMotion);
  }

  function trackCameraMotionFallback() {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas || video.readyState < 2) {
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
          x: clamp(x),
          y: clamp(y),
          smile: clamp(0.42 + expressionBoost + strength * 0.3, 0.12, 0.95),
          blink: expression === "blink" ? 1 : Math.max(0, Math.sin(Date.now() / 700) > 0.965 ? 1 : 0),
          hand: handGesture === "wave" ? 0.95 : handGesture === "point" ? 0.72 : cameraHand,
          mouth: clamp(strength * 0.75, 0.08, 0.75),
          touchX: clamp(x * 0.8),
          touchY: clamp(y * 0.8)
        });
      }
    }

    previousFrameRef.current = new Uint8ClampedArray(frame);
  }

  function updateMotionFromPointer(clientX: number, clientY: number, target: HTMLElement) {
    const rect = target.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width - 0.5) * 2;
    const y = ((clientY - rect.top) / rect.height - 0.5) * 2;
    const expressionBoost = expression === "smile" ? 0.35 : expression === "serious" ? -0.18 : 0;

    setMotion({
      x: clamp(x),
      y: clamp(y),
      smile: clamp(0.45 + expressionBoost - y * 0.12, 0.12, 0.95),
      blink: expression === "blink" ? 1 : Math.max(0, Math.sin(Date.now() / 700) > 0.96 ? 1 : 0),
      hand: handGesture === "wave" ? 0.95 : handGesture === "point" ? 0.7 : clamp(0.3 - y * 0.25, 0.12, 0.85),
      mouth: clamp(0.18 - y * 0.14, 0.06, 0.72),
      touchX: clamp(x),
      touchY: clamp(y)
    });
  }

  function loadReferenceImage(file: File | undefined) {
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      setReferenceImage(typeof reader.result === "string" ? reader.result : "");
      setFictionalIdentity("uploaded");
      setAvatarStyle("photo");
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
              <span>{mode === "realtime" ? "camera-driven live output" : "Provider: mock adapter"}</span>
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
                  <span>Upload the photo you want to animate</span>
                  <small>Use your own photo, a fictional character, or a licensed reference.</small>
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
                      {liveEnabled ? (cameraDrivenGestures ? trackingLabel : "manual tracking") : "standby"}
                    </span>
                    <span>face {Math.round(faceConfidence * 100)}%</span>
                    <span>hand {Math.round(handConfidence * 100)}%</span>
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
                    Tracking engine
                    <select value={trackingMode} onChange={(event) => setTrackingMode(event.target.value as "landmarks" | "motion")}>
                      <option value="landmarks">Real face + hand landmarks</option>
                      <option value="motion">Simple motion fallback</option>
                    </select>
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
                    Output mode
                    <select value={avatarStyle} onChange={(event) => setAvatarStyle(event.target.value)}>
                      <option value="photo">Real-time photo puppet</option>
                      <option value="portrait">Portrait close-up</option>
                      <option value="fullbody">Full body motion</option>
                      <option value="cinematic">Fallback generated avatar</option>
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
                    Motion strength: {motionIntensity.toFixed(1)}x
                    <input
                      max="2.4"
                      min="0.4"
                      onChange={(event) => setMotionIntensity(Number(event.target.value))}
                      step="0.1"
                      type="range"
                      value={motionIntensity}
                    />
                  </label>

                  <label className="field range-field">
                    Photo zoom: {puppetZoom.toFixed(2)}x
                    <input
                      max="1.8"
                      min="0.85"
                      onChange={(event) => setPuppetZoom(Number(event.target.value))}
                      step="0.01"
                      type="range"
                      value={puppetZoom}
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
                    ? "Live puppet sessions can be recorded or streamed later"
                    : "Drop source image or training photos here"}
              </span>
              <small>
                {mode === "audio"
                  ? "Audio upload and recording flow is scaffolded for MP3/WAV."
                  : mode === "realtime"
                    ? "This preview uses local browser face and hand landmarks with no artificial delay."
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
                  {referenceImage ? (
                    <div
                      className="photo-puppet"
                      style={{
                        transform: `translate(${delayedMotion.x * 28 * motionIntensity}px, ${
                          delayedMotion.y * 18 * motionIntensity
                        }px) rotate(${delayedMotion.x * 4 * motionIntensity}deg) scale(${puppetZoom})`
                      }}
                    >
                      <img alt="Live photo puppet output" className="puppet-base" src={referenceImage} />
                      <div
                        className="puppet-layer puppet-body"
                        style={{
                          backgroundImage: `url(${referenceImage})`,
                          transform: `translate(${delayedMotion.x * -10 * motionIntensity}px, ${
                            delayedMotion.y * 10 * motionIntensity
                          }px) rotate(${delayedMotion.x * -2}deg)`
                        }}
                      />
                      <div
                        className="puppet-layer puppet-hair"
                        style={{
                          backgroundImage: `url(${referenceImage})`,
                          transform: `translate(${delayedMotion.x * 14 * motionIntensity}px, ${
                            (delayedMotion.y * 8 - delayedMotion.hand * 8) * motionIntensity
                          }px) rotate(${(delayedMotion.x * 3.5 + delayedMotion.touchX * delayedMotion.hand * 2) * motionIntensity}deg)`
                        }}
                      />
                      <div
                        className="puppet-layer puppet-face"
                        style={{
                          backgroundImage: `url(${referenceImage})`,
                          transform: `translate(${delayedMotion.x * 18 * motionIntensity}px, ${
                            delayedMotion.y * 12 * motionIntensity
                          }px) rotate(${delayedMotion.x * 3 * motionIntensity}deg) scale(${
                            1 + delayedMotion.smile * 0.018
                          })`
                        }}
                      />
                      <div
                        className="puppet-layer puppet-cheek left"
                        style={{
                          backgroundImage: `url(${referenceImage})`,
                          transform: `translate(${delayedMotion.x * 10 * motionIntensity}px, ${
                            delayedMotion.y * 6 * motionIntensity
                          }px) scale(${1 + delayedMotion.smile * 0.04})`
                        }}
                      />
                      <div
                        className="puppet-layer puppet-cheek right"
                        style={{
                          backgroundImage: `url(${referenceImage})`,
                          transform: `translate(${delayedMotion.x * 10 * motionIntensity}px, ${
                            delayedMotion.y * 6 * motionIntensity
                          }px) scale(${1 + delayedMotion.smile * 0.04})`
                        }}
                      />
                      <div
                        className="puppet-mouth-live"
                        style={{
                          opacity: 0.18 + delayedMotion.mouth * 0.72,
                          transform: `translate(${delayedMotion.x * 8 * motionIntensity}px, ${
                            (delayedMotion.y * 7 + delayedMotion.mouth * 10) * motionIntensity
                          }px) scaleX(${0.72 + delayedMotion.smile * 0.38}) scaleY(${0.35 + delayedMotion.mouth * 1.25})`
                        }}
                      />
                      <div
                        className="puppet-blink-mask left"
                        style={{ opacity: delayedMotion.blink, transform: `translateY(${delayedMotion.y * 4}px)` }}
                      />
                      <div
                        className="puppet-blink-mask right"
                        style={{ opacity: delayedMotion.blink, transform: `translateY(${delayedMotion.y * 4}px)` }}
                      />
                      <div
                        className="puppet-face-focus"
                        style={{
                          transform: `translate(${delayedMotion.x * 10 * motionIntensity}px, ${
                            delayedMotion.y * 8 * motionIntensity
                          }px) scale(${1 + delayedMotion.smile * 0.025})`
                        }}
                      />
                      <div
                        className="touch-ripple"
                        style={{
                          opacity: delayedMotion.hand > 0.25 ? Math.min(0.85, delayedMotion.hand) : 0,
                          left: `${50 - delayedMotion.touchX * 28}%`,
                          top: `${50 + delayedMotion.touchY * 30}%`
                        }}
                      />
                      <div
                        className={`photo-hand-cue ${handGesture}`}
                        style={{
                          opacity: Math.min(1, delayedMotion.hand + 0.15),
                          transform: `translate(${delayedMotion.touchX * -120}px, ${
                            delayedMotion.touchY * 100 + 70 - delayedMotion.hand * 122
                          }px) rotate(${
                            handGesture === "wave" ? -22 + delayedMotion.x * 20 : handGesture === "point" ? -38 : -8
                          }deg)`
                        }}
                      >
                        <span />
                      </div>
                    </div>
                  ) : (
                    <div className="photo-empty-state">
                      <ImagePlus size={34} />
                      <strong>Upload a reference photo first</strong>
                      <span>The output will use your uploaded image instead of the drawn avatar.</span>
                    </div>
                  )}
                </div>

                <div className="signal-strip">
                  <span>Head X {delayedMotion.x.toFixed(2)}</span>
                  <span>Head Y {delayedMotion.y.toFixed(2)}</span>
                  <span>Smile {delayedMotion.smile.toFixed(2)}</span>
                  <span>Mouth {delayedMotion.mouth.toFixed(2)}</span>
                  <span>Hand {delayedMotion.hand.toFixed(2)}</span>
                  <span>Tracking {Math.round(trackingStrength * 100)}%</span>
                </div>

                <div className="pipeline-steps">
                  <span className={liveEnabled ? "done" : ""}>camera</span>
                  <span className={liveEnabled ? "done" : ""}>gesture map</span>
                  <span className={referenceImage ? "done" : ""}>{fictionalIdentity}</span>
                  <span>live photo puppet</span>
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
