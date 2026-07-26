import {
  Activity,
  Camera,
  Captions,
  Crosshair,
  Film,
  ImagePlus,
  Images,
  Mic2,
  Radio,
  RotateCcw,
  ScanFace,
  ShieldCheck,
  Sparkles,
  Video
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  NeuralFaceClient,
  type NeuralDebugSnapshot,
  type NeuralRendererOptions,
  type NeuralRendererStatus
} from "./realtime/neuralFaceClient";
import {
  convertVoice,
  createGeneration,
  createRealtimeFaceSession,
  Generation,
  GenerationMode,
  listGenerations,
  VideoOptions,
  VoiceOptions
} from "./services/api";

type FacePoint = {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
  presence?: number;
};

type MotionState = {
  x: number;
  y: number;
  roll: number;
  lean: number;
  proximity: number;
  smile: number;
  blink: number;
  hand: number;
  mouth: number;
  touchX: number;
  touchY: number;
};

type BlendshapeCategory = {
  categoryName: string;
  score: number;
};

type TrackingSample = {
  faceScore: number;
  handScore: number;
  label: string;
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
      accent: "Neutral American English"
    },
    createdAt: new Date(Date.now() - 1000 * 60 * 7).toISOString()
  }
];

const defaultVoiceOptions: VoiceOptions = {
  voiceMode: "voice-conversion",
  targetVoice: "Adult man",
  accent: "Neutral American English",
  targetLanguage: "English",
  emotion: "Natural",
  preserveEmotion: true,
  removeNoise: true
};

const languageOptions = ["English", "Spanish", "Portuguese", "French", "Italian", "German", "Japanese", "Korean"];

const accentOptionsByLanguage: Record<string, string[]> = {
  English: ["Neutral American English", "British English", "Australian English", "Irish English", "Indian English"],
  Spanish: ["Latin American Spanish", "Colombian Spanish", "Mexican Spanish", "Caribbean Spanish", "Castilian Spanish"],
  Portuguese: ["Brazilian Portuguese", "European Portuguese"],
  French: ["Parisian French", "Canadian French"],
  Italian: ["Standard Italian", "Northern Italian"],
  German: ["Standard German", "Austrian German"],
  Japanese: ["Tokyo Japanese", "Kansai Japanese"],
  Korean: ["Seoul Korean"]
};

const allAccentOptions = Array.from(new Set(Object.values(accentOptionsByLanguage).flat()));

const getDefaultAccentForLanguage = (language: string) =>
  accentOptionsByLanguage[language]?.[0] ?? "Neutral American English";

const defaultVideoOptions: VideoOptions = {
  mode: "enhance",
  targetLanguage: "English",
  aspectRatio: "original",
  quality: "balanced",
  stabilize: true,
  removeBackground: false,
  addCaptions: true
};

const defaultMotion: MotionState = {
  x: 0,
  y: 0,
  roll: 0,
  lean: 0,
  proximity: 0.5,
  smile: 0.45,
  blink: 0,
  hand: 0.25,
  mouth: 0.12,
  touchX: 0.38,
  touchY: -0.15
};

const defaultNeuralDebug: NeuralDebugSnapshot = {
  bufferedBytes: 0,
  connected: false,
  framesReceived: 0,
  framesRejected: 0,
  framesSent: 0,
  lastSkipReason: "not started",
  lastServerMessage: "none",
  socketState: "none"
};

const clamp = (value: number, min = -1, max = 1) => Math.max(min, Math.min(max, value));
const mediapipeVersion = "0.10.35";
const getAudioContext = () => {
  const audioWindow = window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  return new (audioWindow.AudioContext ?? audioWindow.webkitAudioContext)();
};

const writeAscii = (view: DataView, offset: number, value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
};

const audioBufferToWavBlob = (buffer: AudioBuffer) => {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  const frameCount = buffer.length;
  const bytesPerSample = 2;
  const dataSize = frameCount * buffer.numberOfChannels * bytesPerSample;
  const output = new ArrayBuffer(44 + dataSize);
  const view = new DataView(output);
  let offset = 44;

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, buffer.numberOfChannels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * buffer.numberOfChannels * bytesPerSample, true);
  view.setUint16(32, buffer.numberOfChannels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channels.length; channel += 1) {
      const sample = clamp(channels[channel][frame] ?? 0, -1, 1);
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }
  }

  return new Blob([output], { type: "audio/wav" });
};

const blobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.split(",")[1] ?? "");
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Could not read audio.")));
    reader.readAsDataURL(blob);
  });

const getVoicePreviewProfile = (options: VoiceOptions) => {
  const target = `${options.targetVoice} ${options.accent} ${options.emotion}`.toLowerCase();
  let playbackRate = 0.9;
  let lowShelfGain = 6;
  let highShelfGain = -1.5;
  let driveGain = 1;
  let compressorRatio = 2.4;
  let distortion = 0.03;
  let label = "Adult man: lower pitch, stronger low end";

  if (target.includes("woman") || target.includes("chica") || target.includes("female")) {
    playbackRate = 1.24;
    lowShelfGain = -5.5;
    highShelfGain = 8;
    compressorRatio = 2;
    distortion = 0.015;
    label = "Adult woman: higher pitch, brighter tone";
  }

  if (target.includes("old man") || target.includes("viejo")) {
    playbackRate = 0.72;
    lowShelfGain = 8;
    highShelfGain = -7.5;
    driveGain = 0.9;
    compressorRatio = 3.2;
    distortion = 0.09;
    label = "Old man: very low pitch, darker tone, rougher texture";
  }

  if (target.includes("old woman") || target.includes("vieja")) {
    playbackRate = 1.02;
    lowShelfGain = -0.8;
    highShelfGain = 3.8;
    driveGain = 0.94;
    compressorRatio = 3;
    distortion = 0.065;
    label = "Old woman: thinner tone, softer level, rougher texture";
  }

  if (target.includes("boy") || target.includes("niño")) {
    playbackRate = 1.46;
    lowShelfGain = -8;
    highShelfGain = 8;
    compressorRatio = 1.8;
    distortion = 0.01;
    label = "Boy: much higher pitch, light tone";
  }

  if (target.includes("girl") || target.includes("niña")) {
    playbackRate = 1.52;
    lowShelfGain = -7;
    highShelfGain = 8;
    compressorRatio = 1.7;
    distortion = 0.01;
    label = "Girl: highest pitch, bright tone";
  }

  if (target.includes("studio")) {
    playbackRate = 1.04;
    lowShelfGain = 1.5;
    highShelfGain = 2.2;
  }

  if (target.includes("warm") || target.includes("narrator")) {
    playbackRate = 0.88;
    lowShelfGain = 6.5;
    highShelfGain = -2.2;
  }

  if (target.includes("assistant") || target.includes("clear")) {
    playbackRate = 1.12;
    lowShelfGain = -2.2;
    highShelfGain = 5.4;
  }

  if (target.includes("british")) {
    playbackRate += 0.02;
    highShelfGain += 1.1;
  }

  if (target.includes("spanish") || target.includes("colombian") || target.includes("mexican")) {
    playbackRate -= 0.03;
    lowShelfGain += 1.8;
  }

  if (target.includes("energetic")) {
    playbackRate += 0.06;
    highShelfGain += 1.8;
    driveGain = 1.08;
  }

  if (target.includes("calm") || target.includes("serious")) {
    playbackRate -= 0.04;
    lowShelfGain += 1.4;
  }

  return {
    compressorRatio,
    distortion,
    driveGain,
    highShelfGain: clamp(highShelfGain, -8, 8),
    label,
    lowShelfGain: clamp(lowShelfGain, -8, 8),
    playbackRate: clamp(playbackRate, 0.68, 1.56)
  };
};

const createDistortionCurve = (amount: number) => {
  const samples = 2048;
  const curve = new Float32Array(samples);
  const drive = amount * 90;

  for (let index = 0; index < samples; index += 1) {
    const x = (index * 2) / samples - 1;
    curve[index] = ((3 + drive) * x * 20 * (Math.PI / 180)) / (Math.PI + drive * Math.abs(x));
  }

  return curve;
};

const smoothMotion = (current: MotionState, next: MotionState, amount = 0.34): MotionState => ({
  x: current.x + (next.x - current.x) * amount,
  y: current.y + (next.y - current.y) * amount,
  roll: current.roll + (next.roll - current.roll) * amount,
  lean: current.lean + (next.lean - current.lean) * amount,
  proximity: current.proximity + (next.proximity - current.proximity) * amount,
  smile: current.smile + (next.smile - current.smile) * amount,
  blink: current.blink + (next.blink - current.blink) * 0.58,
  hand: current.hand + (next.hand - current.hand) * amount,
  mouth: current.mouth + (next.mouth - current.mouth) * 0.42,
  touchX: current.touchX + (next.touchX - current.touchX) * amount,
  touchY: current.touchY + (next.touchY - current.touchY) * amount
});
const cloneLandmarks = (points: FacePoint[]) => points.map((point) => ({ ...point }));
const smoothLandmarks = (current: FacePoint[] | null, next: FacePoint[], smoothing: number) => {
  if (!current || current.length !== next.length) {
    return cloneLandmarks(next);
  }

  const alpha = clamp(0.9 - smoothing * 0.82, 0.08, 0.9);
  return next.map((point, index) => {
    const previous = current[index] ?? point;
    const limitedX = previous.x + clamp(point.x - previous.x, -0.035, 0.035);
    const limitedY = previous.y + clamp(point.y - previous.y, -0.035, 0.035);

    return {
      ...point,
      x: previous.x + (limitedX - previous.x) * alpha,
      y: previous.y + (limitedY - previous.y) * alpha,
      z: previous.z === undefined || point.z === undefined ? point.z : previous.z + (point.z - previous.z) * alpha
    };
  });
};

export function App() {
  const [mode, setMode] = useState<GenerationMode>("image");
  const [prompt, setPrompt] = useState("Create a cinematic studio portrait for a consent-based AI avatar profile.");
  const [voiceOptions, setVoiceOptions] = useState<VoiceOptions>(defaultVoiceOptions);
  const [videoOptions, setVideoOptions] = useState<VideoOptions>(defaultVideoOptions);
  const [videoFileName, setVideoFileName] = useState("");
  const [videoPreviewUrl, setVideoPreviewUrl] = useState("");
  const [videoError, setVideoError] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState("");
  const [recordedAudioBlob, setRecordedAudioBlob] = useState<Blob | null>(null);
  const [recordedAudioName, setRecordedAudioName] = useState("");
  const [processedAudioUrl, setProcessedAudioUrl] = useState("");
  const [processedAudioName, setProcessedAudioName] = useState("");
  const [processedAudioDetails, setProcessedAudioDetails] = useState("");
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [voicePreviewError, setVoicePreviewError] = useState("");
  const [micError, setMicError] = useState("");
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [fps, setFps] = useState(0);
  const [frameLatencyMs, setFrameLatencyMs] = useState(0);
  const [motionIntensity, setMotionIntensity] = useState(1);
  const [smoothing, setSmoothing] = useState(0.68);
  const [eyeRetargeting, setEyeRetargeting] = useState(true);
  const [headRotationStrength, setHeadRotationStrength] = useState(0.9);
  const [headPitchStrength, setHeadPitchStrength] = useState(1);
  const [headRollStrength, setHeadRollStrength] = useState(1);
  const [headTranslationStrength, setHeadTranslationStrength] = useState(1);
  const [headYawStrength, setHeadYawStrength] = useState(1);
  const [lipRetargeting, setLipRetargeting] = useState(true);
  const [fictionalIdentity, setFictionalIdentity] = useState<"self" | "fictional" | "licensed">("self");
  const [referenceImage, setReferenceImage] = useState("");
  const [referenceStatus, setReferenceStatus] = useState("Upload a reference with one visible face.");
  const [isCalibrated, setIsCalibrated] = useState(false);
  const [cameraDrivenGestures, setCameraDrivenGestures] = useState(true);
  const [trackingStrength, setTrackingStrength] = useState(0);
  const [trackingMode, setTrackingMode] = useState<"landmarks" | "motion">("landmarks");
  const [, setTrackingReady] = useState(false);
  const [trackingLabel, setTrackingLabel] = useState("landmark engine idle");
  const [faceConfidence, setFaceConfidence] = useState(0);
  const [handConfidence, setHandConfidence] = useState(0);
  const [motion, setMotion] = useState<MotionState>(defaultMotion);
  const [neuralStatus, setNeuralStatus] = useState<NeuralRendererStatus>("idle");
  const [neuralMessage, setNeuralMessage] = useState("Neural GPU disconnected");
  const [neuralFps, setNeuralFps] = useState(0);
  const [neuralLatencyMs, setNeuralLatencyMs] = useState(0);
  const [neuralInferenceMs, setNeuralInferenceMs] = useState(0);
  const [neuralDebug, setNeuralDebug] = useState<NeuralDebugSnapshot>(defaultNeuralDebug);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [generations, setGenerations] = useState<Generation[]>(samples);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const outputCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const referenceElementRef = useRef<HTMLImageElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const loopSessionRef = useRef(0);
  const previousFrameRef = useRef<Uint8ClampedArray | null>(null);
  const faceLandmarkerRef = useRef<any>(null);
  const referenceLandmarkerRef = useRef<any>(null);
  const handLandmarkerRef = useRef<any>(null);
  const trackingReadyRef = useRef(false);
  const latestFaceLandmarksRef = useRef<FacePoint[] | null>(null);
  const smoothedFaceLandmarksRef = useRef<FacePoint[] | null>(null);
  const neutralFaceLandmarksRef = useRef<FacePoint[] | null>(null);
  const lostFaceFramesRef = useRef(0);
  const lastDetectionAtRef = useRef(0);
  const lastTrackingSampleRef = useRef<TrackingSample>({
    faceScore: 0,
    handScore: 0,
    label: "waiting for camera"
  });
  const smoothedMotionRef = useRef<MotionState>(defaultMotion);
  const neuralClientRef = useRef<NeuralFaceClient | null>(null);
  const hasNeuralFrameRef = useRef(false);
  const neuralMetricsRef = useRef({
    frameCount: 0,
    frameWindowStartedAt: performance.now()
  });
  const metricsRef = useRef({
    frameCount: 0,
    frameWindowStartedAt: performance.now(),
    latencyTotal: 0,
    lastUiUpdateAt: 0
  });
  const audioStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  if (!neuralClientRef.current) {
    neuralClientRef.current = new NeuralFaceClient();
  }

  const settingsRef = useRef({
    cameraDrivenGestures,
    smoothing,
    trackingMode
  });
  settingsRef.current = {
    cameraDrivenGestures,
    smoothing,
    trackingMode
  };

  useEffect(() => {
    listGenerations()
      .then((items) => items.length && setGenerations(items))
      .catch(() => {
        setGenerations(samples);
      });
  }, []);

  useEffect(() => {
    if (mode !== "realtime") {
      stopCamera();
    }
  }, [mode]);

  useEffect(() => {
    hasNeuralFrameRef.current = false;
    window.requestAnimationFrame(renderPreviewFrame);
  }, [referenceImage]);

  useEffect(() => {
    if (liveEnabled) {
      neuralClientRef.current?.updateOptions(getNeuralOptions());
    }
  }, [
    eyeRetargeting,
    headPitchStrength,
    headRollStrength,
    headRotationStrength,
    headTranslationStrength,
    headYawStrength,
    lipRetargeting,
    liveEnabled,
    motionIntensity,
    smoothing
  ]);

  useEffect(() => {
    return () => {
      loopSessionRef.current += 1;
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      neuralClientRef.current?.close();
      faceLandmarkerRef.current?.close();
      referenceLandmarkerRef.current?.close();
      handLandmarkerRef.current?.close();
    };
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

  useEffect(() => {
    return () => {
      if (processedAudioUrl) {
        URL.revokeObjectURL(processedAudioUrl);
      }
    };
  }, [processedAudioUrl]);

  useEffect(() => {
    return () => {
      if (videoPreviewUrl) {
        URL.revokeObjectURL(videoPreviewUrl);
      }
    };
  }, [videoPreviewUrl]);

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
        videoOptions: mode === "video" ? videoOptions : undefined,
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
    if (processedAudioUrl) {
      URL.revokeObjectURL(processedAudioUrl);
    }
    setProcessedAudioUrl("");
    setProcessedAudioName("");
    setProcessedAudioDetails("");
    setVoicePreviewError("");
    setVoiceOptions((current) => {
      if (key === "targetLanguage") {
        return {
          ...current,
          accent: getDefaultAccentForLanguage(String(value)),
          targetLanguage: value as VoiceOptions["targetLanguage"],
          voiceMode: "translation"
        };
      }

      if (key === "accent" && current.voiceMode === "voice-conversion") {
        return { ...current, accent: value as VoiceOptions["accent"], voiceMode: "accent" };
      }

      return { ...current, [key]: value };
    });
  }

  function updateVideoOption<Key extends keyof VideoOptions>(key: Key, value: VideoOptions[Key]) {
    setVideoOptions((current) => ({ ...current, [key]: value }));
  }

  function loadVideoFile(file: File | undefined) {
    if (!file) {
      return;
    }
    if (!file.type.startsWith("video/")) {
      setVideoError("Choose an MP4, WebM, or MOV video file.");
      return;
    }
    if (file.size > 250 * 1024 * 1024) {
      setVideoError("Keep the video under 250 MB for this editor queue.");
      return;
    }

    if (videoPreviewUrl) {
      URL.revokeObjectURL(videoPreviewUrl);
    }

    setVideoError("");
    setVideoFileName(file.name);
    setVideoPreviewUrl(URL.createObjectURL(file));
    if (prompt.trim().length < 12) {
      setPrompt("Enhance this video with stable motion, clean lighting, captions, and social-ready export.");
    }
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
        if (processedAudioUrl) {
          URL.revokeObjectURL(processedAudioUrl);
        }

        setRecordedAudioBlob(audioBlob);
        setRecordedAudioUrl(audioUrl);
        setRecordedAudioName(`voice-recording-${new Date().toISOString().slice(11, 19).replaceAll(":", "-")}.webm`);
        setProcessedAudioName("");
        setProcessedAudioUrl("");
        setProcessedAudioDetails("");
        setVoicePreviewError("");
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

  async function processVoicePreview() {
    setVoicePreviewError("");

    if (!recordedAudioBlob) {
      setVoicePreviewError("Record your voice first, then create the changed preview.");
      return;
    }

    if (!consentConfirmed) {
      setVoicePreviewError("Confirm that you have rights and consent before changing or translating voice.");
      return;
    }

    setIsProcessingVoice(true);

    try {
      const shouldUseProvider = true;

      if (shouldUseProvider) {
        try {
          const result = await convertVoice({
            audioBase64: await blobToBase64(recordedAudioBlob),
            consentConfirmed,
            fileName: recordedAudioName || "voice-recording.webm",
            mimeType: recordedAudioBlob.type || "audio/webm",
            voiceOptions
          });
          const processedBlob = new Blob(
            [Uint8Array.from(atob(result.outputAudioBase64), (character) => character.charCodeAt(0))],
            { type: result.outputMimeType }
          );
          const nextUrl = URL.createObjectURL(processedBlob);

          if (processedAudioUrl) {
            URL.revokeObjectURL(processedAudioUrl);
          }

          setProcessedAudioUrl(nextUrl);
          setProcessedAudioName(
            `openai-${voiceOptions.voiceMode}-${voiceOptions.targetLanguage.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.mp3`
          );
          setProcessedAudioDetails(
            `OpenAI ${voiceOptions.voiceMode}: "${result.transcript}" -> "${result.translatedText}". Voice ${result.voiceUsed}, ${voiceOptions.accent}.`
          );
          return;
        } catch (providerError) {
          setVoicePreviewError(
            providerError instanceof Error
              ? `AI voice provider failed, so I made a local preview instead: ${providerError.message}`
              : "AI voice provider failed, so I made a local preview instead."
          );
        }
      }

      const sourceBytes = await recordedAudioBlob.arrayBuffer();
      const decoder = getAudioContext();
      const inputBuffer = await decoder.decodeAudioData(sourceBytes.slice(0));
      await decoder.close();

      const profile = getVoicePreviewProfile(voiceOptions);
      const renderedLength = Math.max(1, Math.ceil(inputBuffer.length / profile.playbackRate));
      const offline = new OfflineAudioContext(inputBuffer.numberOfChannels, renderedLength, inputBuffer.sampleRate);
      const source = offline.createBufferSource();
      const highPass = offline.createBiquadFilter();
      const lowShelf = offline.createBiquadFilter();
      const highShelf = offline.createBiquadFilter();
      const compressor = offline.createDynamicsCompressor();
      const shaper = offline.createWaveShaper();
      const gain = offline.createGain();

      source.buffer = inputBuffer;
      source.playbackRate.value = profile.playbackRate;

      highPass.type = "highpass";
      highPass.frequency.value = voiceOptions.removeNoise ? 90 : 35;
      highPass.Q.value = 0.65;

      lowShelf.type = "lowshelf";
      lowShelf.frequency.value = 220;
      lowShelf.gain.value = profile.lowShelfGain;

      highShelf.type = "highshelf";
      highShelf.frequency.value = 3200;
      highShelf.gain.value = profile.highShelfGain;

      shaper.curve = createDistortionCurve(profile.distortion);
      shaper.oversample = "2x";

      // Keeps the quick browser preview from clipping after pitch/EQ changes.
      compressor.threshold.value = -20;
      compressor.knee.value = 22;
      compressor.ratio.value = voiceOptions.preserveEmotion ? profile.compressorRatio : profile.compressorRatio + 1.2;
      compressor.attack.value = 0.008;
      compressor.release.value = 0.16;
      gain.gain.value = profile.driveGain;

      source.connect(highPass);
      highPass.connect(lowShelf);
      lowShelf.connect(highShelf);
      highShelf.connect(shaper);
      shaper.connect(compressor);
      compressor.connect(gain);
      gain.connect(offline.destination);

      source.start(0);
      const renderedBuffer = await offline.startRendering();
      const processedBlob = audioBufferToWavBlob(renderedBuffer);
      const nextUrl = URL.createObjectURL(processedBlob);

      if (processedAudioUrl) {
        URL.revokeObjectURL(processedAudioUrl);
      }

      setProcessedAudioUrl(nextUrl);
      setProcessedAudioName(`changed-${voiceOptions.targetVoice.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.wav`);
      setProcessedAudioDetails(
        `${profile.label}. Local preview only: pitch rate ${profile.playbackRate.toFixed(2)}x, low EQ ${profile.lowShelfGain.toFixed(1)} dB, high EQ ${profile.highShelfGain.toFixed(1)} dB.`
      );
    } catch (previewError) {
      setVoicePreviewError(
        previewError instanceof Error
          ? `Voice preview failed: ${previewError.message}`
          : "Voice preview failed. Try recording again in this browser."
      );
    } finally {
      setIsProcessingVoice(false);
    }
  }

  async function startCamera() {
    setCameraError("");
    setTrackingLabel("requesting camera");
    cancelCameraLoop();
    streamRef.current?.getTracks().forEach((track) => track.stop());

    if (!referenceImage) {
      setCameraError("Upload one clear reference portrait before starting the neural renderer.");
      return;
    }
    if (!consentConfirmed) {
      setCameraError("Confirm that you have rights and consent before starting the neural renderer.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          frameRate: { ideal: 30, max: 60 },
          height: { ideal: 720 },
          width: { ideal: 1280 }
        },
        audio: false
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      if (trackingMode === "landmarks") {
        await initializeLandmarkTracking();
      }

      setLiveEnabled(true);
      hasNeuralFrameRef.current = false;
      setTrackingLabel(trackingMode === "landmarks" ? "acquiring face" : "motion fallback");
      metricsRef.current = {
        frameCount: 0,
        frameWindowStartedAt: performance.now(),
        latencyTotal: 0,
        lastUiUpdateAt: 0
      };
      lastDetectionAtRef.current = 0;
      window.requestAnimationFrame(renderPreviewFrame);
      void connectNeuralRenderer();
      const session = ++loopSessionRef.current;
      animationFrameRef.current = window.requestAnimationFrame(() => trackCameraFrame(session));
    } catch {
      setCameraError("Camera permission is needed for the real-time preview.");
      setTrackingLabel("camera blocked");
      setLiveEnabled(false);
    }
  }

  function cancelCameraLoop() {
    loopSessionRef.current += 1;
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }

  function stopCamera() {
    cancelCameraLoop();
    neuralClientRef.current?.close();
    hasNeuralFrameRef.current = false;
    previousFrameRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setLiveEnabled(false);
    setTrackingStrength(0);
    setFaceConfidence(0);
    setHandConfidence(0);
    setFps(0);
    setFrameLatencyMs(0);
    setNeuralFps(0);
    setNeuralLatencyMs(0);
    setNeuralInferenceMs(0);
    setNeuralDebug(defaultNeuralDebug);
    setNeuralStatus("idle");
    setNeuralMessage("Neural GPU disconnected");
    lastDetectionAtRef.current = 0;
    lastTrackingSampleRef.current = {
      faceScore: 0,
      handScore: 0,
      label: "waiting for camera"
    };
    smoothedMotionRef.current = defaultMotion;
    setMotion(defaultMotion);
    setTrackingLabel(trackingReadyRef.current ? "landmark engine ready" : "landmark engine idle");
    renderPreviewFrame();
  }

  async function initializeLandmarkTracking() {
    if (faceLandmarkerRef.current && handLandmarkerRef.current && referenceLandmarkerRef.current) {
      trackingReadyRef.current = true;
      setTrackingReady(true);
      setTrackingLabel("landmark tracking");
      return true;
    }

    try {
      setTrackingLabel("loading face and hand tracker");
      const { FaceLandmarker, FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${mediapipeVersion}/wasm`);

      if (!faceLandmarkerRef.current) {
        faceLandmarkerRef.current = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task"
          },
          minFaceDetectionConfidence: 0.55,
          minFacePresenceConfidence: 0.55,
          minTrackingConfidence: 0.55,
          numFaces: 1,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
          runningMode: "VIDEO"
        });
      }

      if (!referenceLandmarkerRef.current) {
        referenceLandmarkerRef.current = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task"
          },
          minFaceDetectionConfidence: 0.5,
          minFacePresenceConfidence: 0.5,
          numFaces: 1,
          outputFaceBlendshapes: false,
          runningMode: "IMAGE"
        });
      }

      if (!handLandmarkerRef.current) {
        handLandmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task"
          },
          minHandDetectionConfidence: 0.55,
          minHandPresenceConfidence: 0.55,
          minTrackingConfidence: 0.55,
          numHands: 2,
          runningMode: "VIDEO"
        });
      }

      trackingReadyRef.current = true;
      setTrackingReady(true);
      setTrackingLabel("landmark tracking");
      return true;
    } catch {
      trackingReadyRef.current = false;
      setTrackingMode("motion");
      setTrackingReady(false);
      setTrackingLabel("motion fallback");
      return false;
    }
  }

  function trackCameraFrame(session: number) {
    if (session !== loopSessionRef.current || !streamRef.current) {
      return;
    }

    const startedAt = performance.now();
    const settings = settingsRef.current;
    let sample: TrackingSample = {
      faceScore: faceConfidence,
      handScore: handConfidence,
      label: settings.cameraDrivenGestures ? "tracking" : "manual tracking"
    };

    if (settings.cameraDrivenGestures) {
      if (settings.trackingMode === "landmarks" && trackingReadyRef.current && faceLandmarkerRef.current) {
        if (startedAt - lastDetectionAtRef.current >= 28) {
          sample = trackLandmarkFrame();
          lastDetectionAtRef.current = startedAt;
          lastTrackingSampleRef.current = sample;
        } else {
          sample = lastTrackingSampleRef.current;
        }
      } else {
        sample = trackCameraMotionFallback();
      }
    }

    if (!hasNeuralFrameRef.current) {
      renderPreviewFrame();
    }
    if (videoRef.current) {
      void neuralClientRef.current?.sendVideoFrame(videoRef.current);
    }
    updateTrackingMetrics(startedAt, sample);

    if (session === loopSessionRef.current && streamRef.current) {
      animationFrameRef.current = window.requestAnimationFrame(() => trackCameraFrame(session));
    }
  }

  function trackLandmarkFrame(): TrackingSample {
    const video = videoRef.current;

    if (!video || video.readyState < 2) {
      return { faceScore: 0, handScore: 0, label: "waiting for camera" };
    }

    const now = performance.now();
    const faceResult = faceLandmarkerRef.current.detectForVideo(video, now);
    const handResult = handLandmarkerRef.current?.detectForVideo(video, now);
    const faceLandmarks = faceResult.faceLandmarks?.[0] as FacePoint[] | undefined;
    const handLandmarks = handResult?.landmarks?.[0] as FacePoint[] | undefined;
    const categories = (faceResult.faceBlendshapes?.[0]?.categories ?? []) as BlendshapeCategory[];
    const score = (name: string) => categories.find((item) => item.categoryName === name)?.score ?? 0;
    const settings = settingsRef.current;
    let nextMotion = smoothedMotionRef.current;
    let faceScore = 0;
    let handScore = Math.max(0, nextMotion.hand * 0.86);
    let label = "face lost";

    if (faceLandmarks) {
      lostFaceFramesRef.current = 0;
      latestFaceLandmarksRef.current = cloneLandmarks(faceLandmarks);
      const smoothedLandmarks = smoothLandmarks(smoothedFaceLandmarksRef.current, faceLandmarks, settings.smoothing);
      smoothedFaceLandmarksRef.current = smoothedLandmarks;

      const hadCalibration = Boolean(neutralFaceLandmarksRef.current);
      if (!hadCalibration) {
        neutralFaceLandmarksRef.current = cloneLandmarks(smoothedLandmarks);
        setIsCalibrated(true);
      }

      const nose = faceLandmarks[1] ?? faceLandmarks[4] ?? faceLandmarks[0];
      const leftEyeOuter = faceLandmarks[33];
      const rightEyeOuter = faceLandmarks[263];
      const leftCheek = faceLandmarks[234];
      const rightCheek = faceLandmarks[454];
      const mouthTop = faceLandmarks[13];
      const mouthBottom = faceLandmarks[14];
      const faceWidth = leftCheek && rightCheek ? Math.abs(rightCheek.x - leftCheek.x) : 0.28;
      const roll =
        leftEyeOuter && rightEyeOuter ? Math.atan2(rightEyeOuter.y - leftEyeOuter.y, rightEyeOuter.x - leftEyeOuter.x) : 0;
      const mouthDistance = mouthTop && mouthBottom ? clamp((mouthBottom.y - mouthTop.y) * 18, 0, 1) : 0;
      const smileScore = Math.max(score("mouthSmileLeft"), score("mouthSmileRight"), score("mouthDimpleLeft"));
      const blinkScore = Math.max(score("eyeBlinkLeft"), score("eyeBlinkRight"));
      const browScore = Math.max(score("browInnerUp"), score("browOuterUpLeft"), score("browOuterUpRight"));
      const landmarkConfidence = faceLandmarks
        .map((point) => point.presence ?? point.visibility)
        .filter((value): value is number => typeof value === "number");

      faceScore =
        landmarkConfidence.length > 0
          ? landmarkConfidence.reduce((total, value) => total + value, 0) / landmarkConfidence.length
          : 1;
      label = hadCalibration ? "tracking locked" : "auto calibrated";
      nextMotion = {
        ...nextMotion,
        x: clamp((0.5 - nose.x) * 2.2),
        y: clamp((nose.y - 0.44) * 2.1),
        roll: clamp(roll * 2.1, -0.5, 0.5),
        lean: clamp((0.28 - faceWidth) * 3.2, -0.45, 0.55),
        proximity: clamp((faceWidth - 0.18) * 3.6, 0, 1),
        smile: clamp(0.2 + smileScore * 0.9 + mouthDistance * 0.35, 0.08, 1),
        blink: clamp(blinkScore * 1.4, 0, 1),
        mouth: clamp(mouthDistance + score("jawOpen") * 0.7 + browScore * 0.08, 0, 1)
      };
    } else {
      lostFaceFramesRef.current += 1;
      latestFaceLandmarksRef.current = null;
      faceScore = clamp(1 - lostFaceFramesRef.current / 14, 0, 1);
      label = lostFaceFramesRef.current < 5 ? "reacquiring face" : "face lost";

      if (lostFaceFramesRef.current > 8) {
        smoothedFaceLandmarksRef.current = null;
      } else if (smoothedFaceLandmarksRef.current && neutralFaceLandmarksRef.current) {
        smoothedFaceLandmarksRef.current = smoothLandmarks(
          smoothedFaceLandmarksRef.current,
          neutralFaceLandmarksRef.current,
          0.92
        );
      }
    }

    if (handLandmarks) {
      const wrist = handLandmarks[0];
      const indexTip = handLandmarks[8] ?? wrist;
      const middleTip = handLandmarks[12] ?? indexTip;
      const highestFinger = Math.min(indexTip.y, middleTip.y, wrist.y);
      handScore = clamp((0.82 - highestFinger) * 2.4, 0.1, 1);
      nextMotion = {
        ...nextMotion,
        hand: handScore,
        touchX: clamp((0.5 - indexTip.x) * 2),
        touchY: clamp((indexTip.y - 0.5) * 2)
      };
    } else {
      nextMotion = {
        ...nextMotion,
        hand: Math.max(0.05, nextMotion.hand * 0.9)
      };
    }

    const motionAlpha = clamp(0.72 - settings.smoothing * 0.58, 0.12, 0.52);
    const smoothed = smoothMotion(smoothedMotionRef.current, nextMotion, faceLandmarks ? motionAlpha : 0.12);
    smoothedMotionRef.current = smoothed;
    setMotion(smoothed);

    return {
      faceScore,
      handScore: handLandmarks ? handScore : 0,
      label
    };
  }

  function trackCameraMotionFallback(): TrackingSample {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas || video.readyState < 2) {
      return { faceScore: 0, handScore: 0, label: "waiting for camera" };
    }

    const width = 96;
    const height = 72;
    const context = canvas.getContext("2d", { willReadFrequently: true });

    if (!context) {
      return { faceScore: 0, handScore: 0, label: "motion fallback unavailable" };
    }

    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);
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
        const cameraHand = centerY < height * 0.45 && strength > 0.18 ? 0.96 : Math.max(0.18, strength * 1.4);

        const nextMotion = {
          x: clamp(x),
          y: clamp(y),
          roll: clamp(x * 0.22, -0.35, 0.35),
          lean: clamp(strength * 0.28, 0, 0.5),
          proximity: clamp(strength * 1.6, 0.1, 1),
          smile: clamp(0.42 + strength * 0.3, 0.12, 0.95),
          blink: Math.max(0, Math.sin(Date.now() / 700) > 0.965 ? 1 : 0),
          hand: cameraHand,
          mouth: clamp(strength * 0.75, 0.08, 0.75),
          touchX: clamp(x * 0.8),
          touchY: clamp(y * 0.8)
        };
        const smoothed = smoothMotion(smoothedMotionRef.current, nextMotion, 0.28);
        smoothedMotionRef.current = smoothed;
        setMotion(smoothed);
      }
    }

    previousFrameRef.current = new Uint8ClampedArray(frame);
    return {
      faceScore: Math.min(0.62, trackingStrength),
      handScore: Math.min(0.55, smoothedMotionRef.current.hand),
      label: "motion fallback"
    };
  }

  function getNeuralOptions(): NeuralRendererOptions {
    return {
      eyeRetargeting,
      headRotationStrength,
      headPitchStrength,
      headRollStrength,
      headTranslationStrength,
      headYawStrength,
      lipRetargeting,
      motionStrength: motionIntensity,
      smoothing
    };
  }

  async function connectNeuralRenderer() {
    if (!referenceImage || !consentConfirmed) {
      return;
    }

    setNeuralStatus("connecting");
    setNeuralMessage("Requesting a secure GPU session");
    hasNeuralFrameRef.current = false;

    try {
      const session = await createRealtimeFaceSession({
        consentConfirmed,
        referenceType: fictionalIdentity
      });

      await neuralClientRef.current?.connect(
        session,
        referenceImage,
        fictionalIdentity,
        getNeuralOptions(),
        {
          onError: (message) => {
            setCameraError(message);
            setNeuralMessage(message);
            setNeuralStatus("error");
          },
          onDebug: (snapshot) => {
            setNeuralDebug(snapshot);
          },
          onFrame: (frame, metrics) => {
            drawNeuralFrame(frame);
            hasNeuralFrameRef.current = true;
            setNeuralLatencyMs(metrics.latencyMs);

            const now = performance.now();
            const neuralMetrics = neuralMetricsRef.current;
            neuralMetrics.frameCount += 1;
            const elapsed = now - neuralMetrics.frameWindowStartedAt;
            if (elapsed >= 500) {
              setNeuralFps((neuralMetrics.frameCount * 1000) / elapsed);
              neuralMetrics.frameCount = 0;
              neuralMetrics.frameWindowStartedAt = now;
            }
          },
          onMetrics: (metrics) => {
            setNeuralInferenceMs(metrics.inferenceMs);
            if (metrics.serverFps > 0) {
              setNeuralFps(metrics.serverFps);
            }
          },
          onStatus: (status, message) => {
            setNeuralStatus(status);
            setNeuralMessage(message);
          }
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "The neural renderer is unavailable.";
      setCameraError(message);
      setNeuralMessage(message);
      setNeuralStatus("error");
      renderPreviewFrame();
    }
  }

  function renderPreviewFrame() {
    const output = outputCanvasRef.current;
    if (!output) {
      return;
    }

    const video = videoRef.current;
    const reference = referenceElementRef.current;
    const media =
      video && video.readyState >= 2 && video.videoWidth > 0
        ? { height: video.videoHeight, source: video, width: video.videoWidth }
        : reference
          ? { height: reference.naturalHeight, source: reference, width: reference.naturalWidth }
          : null;

    if (!media) {
      return;
    }

    drawMediaToOutput(media.source, media.width, media.height, Boolean(video && media.source === video));
  }

  function drawNeuralFrame(frame: ImageBitmap) {
    try {
      drawMediaToOutput(frame, frame.width, frame.height, false);
    } finally {
      frame.close();
    }
  }

  function drawMediaToOutput(
    media: CanvasImageSource,
    mediaWidth: number,
    mediaHeight: number,
    mirror: boolean
  ) {
    const output = outputCanvasRef.current;
    if (!output || mediaWidth <= 0 || mediaHeight <= 0) {
      return;
    }

    const cssWidth = Math.max(1, Math.round(output.clientWidth || 960));
    const cssHeight = Math.max(1, Math.round(output.clientHeight || 540));
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.25);
    const pixelWidth = Math.round(cssWidth * pixelRatio);
    const pixelHeight = Math.round(cssHeight * pixelRatio);
    if (output.width !== pixelWidth || output.height !== pixelHeight) {
      output.width = pixelWidth;
      output.height = pixelHeight;
    }

    const context = output.getContext("2d", { alpha: false });
    if (!context) {
      return;
    }

    const scale = Math.max(cssWidth / mediaWidth, cssHeight / mediaHeight);
    const width = mediaWidth * scale;
    const height = mediaHeight * scale;
    const left = (cssWidth - width) / 2;
    const top = (cssHeight - height) / 2;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, output.width, output.height);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    if (mirror) {
      context.translate(cssWidth, 0);
      context.scale(-1, 1);
    }
    context.drawImage(media, left, top, width, height);
    context.setTransform(1, 0, 0, 1, 0, 0);
  }

  function updateTrackingMetrics(startedAt: number, sample: TrackingSample) {
    const now = performance.now();
    const metrics = metricsRef.current;
    metrics.frameCount += 1;
    metrics.latencyTotal += now - startedAt;

    if (now - metrics.lastUiUpdateAt < 350) {
      return;
    }

    const elapsed = Math.max(1, now - metrics.frameWindowStartedAt);
    setFps((metrics.frameCount * 1000) / elapsed);
    setFrameLatencyMs(metrics.latencyTotal / metrics.frameCount);
    setFaceConfidence(sample.faceScore);
    setHandConfidence(sample.handScore);
    setTrackingStrength(clamp(sample.faceScore * 0.8 + sample.handScore * 0.2, 0, 1));
    setTrackingLabel(sample.label);
    metrics.frameCount = 0;
    metrics.latencyTotal = 0;
    metrics.frameWindowStartedAt = now;
    metrics.lastUiUpdateAt = now;
  }

  function calibrateFace() {
    const latest = latestFaceLandmarksRef.current;
    if (!latest) {
      setCameraError("Keep one face visible and still before calibrating.");
      return;
    }

    neutralFaceLandmarksRef.current = cloneLandmarks(latest);
    smoothedFaceLandmarksRef.current = cloneLandmarks(latest);
    neuralClientRef.current?.calibrate();
    setIsCalibrated(true);
    setCameraError("");
    setTrackingLabel("neutral pose calibrated");
  }

  function resetCalibration() {
    neutralFaceLandmarksRef.current = null;
    smoothedFaceLandmarksRef.current = latestFaceLandmarksRef.current
      ? cloneLandmarks(latestFaceLandmarksRef.current)
      : null;
    setIsCalibrated(false);
    neuralClientRef.current?.calibrate();
    setTrackingLabel(liveEnabled ? "hold a neutral pose" : "calibration reset");
  }

  function resetFaceControls() {
    setSmoothing(0.68);
    setMotionIntensity(1);
    setEyeRetargeting(true);
    setHeadRotationStrength(0.9);
    setHeadPitchStrength(1);
    setHeadRollStrength(1);
    setHeadTranslationStrength(1);
    setHeadYawStrength(1);
    setLipRetargeting(true);
  }

  async function changeTrackingMode(nextMode: "landmarks" | "motion") {
    setTrackingMode(nextMode);
    if (nextMode === "landmarks" && liveEnabled && !trackingReadyRef.current) {
      await initializeLandmarkTracking();
    }
  }

  function loadReferenceImage(file: File | undefined) {
    if (!file) {
      return;
    }
    if (!file.type.startsWith("image/")) {
      setCameraError("Choose a JPG, PNG, or WebP reference image.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setCameraError("The reference image must be 10 MB or smaller.");
      return;
    }

    if (liveEnabled) {
      stopCamera();
    }
    setReferenceStatus("Analyzing reference face...");
    setCameraError("");
    const reader = new FileReader();
    reader.addEventListener("load", async () => {
      const source = typeof reader.result === "string" ? reader.result : "";
      if (!source) {
        return;
      }

      setReferenceImage(source);
      const image = new Image();
      image.src = source;

      try {
        await image.decode();
        referenceElementRef.current = image;
        hasNeuralFrameRef.current = false;
        window.requestAnimationFrame(renderPreviewFrame);
        const ready = await initializeLandmarkTracking();
        const result = ready ? referenceLandmarkerRef.current?.detect(image) : null;
        const landmarks = result?.faceLandmarks?.[0] as FacePoint[] | undefined;

        if (!landmarks) {
          setReferenceStatus("No clear face found. Use a front-facing, well-lit photo.");
          setCameraError("The reference photo needs one clear, front-facing face.");
          return;
        }

        setReferenceStatus("Reference validated. Neural identity encoding starts with the camera.");
        window.requestAnimationFrame(renderPreviewFrame);
      } catch {
        referenceElementRef.current = null;
        setReferenceStatus("The reference image could not be analyzed.");
        setCameraError("Try another JPG or PNG reference image.");
      }
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
                {mode === "audio" ? "Voice task" : mode === "video" ? "Edit instructions" : "Prompt"}
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
                    <div className="audio-preview-card">
                      <strong>Original recording</strong>
                      <audio controls src={recordedAudioUrl} />
                      <small>{recordedAudioName}</small>
                    </div>

                    <button
                      className="record-action preview-action"
                      disabled={isProcessingVoice}
                      onClick={processVoicePreview}
                      type="button"
                    >
                      <Sparkles size={17} />
                      {isProcessingVoice ? "Changing voice..." : "Preview voice change"}
                    </button>

                    {processedAudioUrl && (
                      <div className="audio-preview-card processed">
                        <strong>Changed voice preview</strong>
                        <audio controls src={processedAudioUrl} />
                        <small>{processedAudioName}</small>
                        {processedAudioDetails && <small>{processedAudioDetails}</small>}
                        <a className="download-preview" download={processedAudioName} href={processedAudioUrl}>
                          Download changed voice
                        </a>
                      </div>
                    )}

                    <small>
                      Voice, accent and language changes try the backend voice provider first. If it is unavailable, the app creates a fast local preview.
                    </small>
                  </div>
                )}

                {micError && <p className="error-message">{micError}</p>}
                {voicePreviewError && <p className="error-message">{voicePreviewError}</p>}

                <label className="field">
                  Mode
                  <select
                    value={voiceOptions.voiceMode}
                    onChange={(event) => updateVoiceOption("voiceMode", event.target.value as VoiceOptions["voiceMode"])}
                  >
                    <option value="voice-conversion">Change voice, keep words</option>
                    <option value="accent">Change accent, keep language</option>
                    <option value="translation">Translate and speak target language</option>
                  </select>
                </label>

                <label className="field">
                  Target voice
                  <select
                    value={voiceOptions.targetVoice}
                    onChange={(event) => updateVoiceOption("targetVoice", event.target.value)}
                  >
                    <option>Adult man</option>
                    <option>Adult woman</option>
                    <option>Old man</option>
                    <option>Old woman</option>
                    <option>Boy</option>
                    <option>Girl</option>
                    <option>Designed studio voice</option>
                    <option>Warm narrator</option>
                    <option>Clear assistant</option>
                  </select>
                </label>

                <label className="field">
                  Accent
                  <select value={voiceOptions.accent} onChange={(event) => updateVoiceOption("accent", event.target.value)}>
                    {allAccentOptions.map((accent) => (
                      <option key={accent}>{accent}</option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  Language
                  <select
                    value={voiceOptions.targetLanguage}
                    onChange={(event) => updateVoiceOption("targetLanguage", event.target.value)}
                  >
                    {languageOptions.map((language) => (
                      <option key={language}>{language}</option>
                    ))}
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

            {mode === "video" && (
              <div className="video-editor">
                <label className="video-drop">
                  <input accept="video/*" onChange={(event) => loadVideoFile(event.target.files?.[0])} type="file" />
                  {videoPreviewUrl ? (
                    <video controls muted playsInline src={videoPreviewUrl} />
                  ) : (
                    <div className="video-drop-empty">
                      <Film size={30} />
                      <strong>Upload a video to edit</strong>
                      <span>MP4, WebM, or MOV under 250 MB</span>
                    </div>
                  )}
                </label>

                {videoFileName && (
                  <div className="file-chip">
                    <Video size={16} />
                    <span>{videoFileName}</span>
                  </div>
                )}

                {videoError && <p className="error-message">{videoError}</p>}

                <div className="video-tool-grid">
                  <label className="field">
                    AI edit
                    <select value={videoOptions.mode} onChange={(event) => updateVideoOption("mode", event.target.value as VideoOptions["mode"])}>
                      <option value="enhance">Enhance lighting and quality</option>
                      <option value="translate">Translate speech and captions</option>
                      <option value="background">Replace or blur background</option>
                      <option value="style">Apply AI style</option>
                      <option value="shorts">Cut into short clips</option>
                    </select>
                  </label>

                  <label className="field">
                    Export format
                    <select
                      value={videoOptions.aspectRatio}
                      onChange={(event) => updateVideoOption("aspectRatio", event.target.value as VideoOptions["aspectRatio"])}
                    >
                      <option value="original">Original</option>
                      <option value="9:16">Vertical 9:16</option>
                      <option value="16:9">Wide 16:9</option>
                      <option value="1:1">Square 1:1</option>
                    </select>
                  </label>

                  <label className="field">
                    Target language
                    <select
                      value={videoOptions.targetLanguage}
                      onChange={(event) => updateVideoOption("targetLanguage", event.target.value)}
                    >
                      <option>English</option>
                      <option>Spanish</option>
                      <option>Portuguese</option>
                      <option>French</option>
                    </select>
                  </label>

                  <label className="field">
                    Quality
                    <select value={videoOptions.quality} onChange={(event) => updateVideoOption("quality", event.target.value as VideoOptions["quality"])}>
                      <option value="draft">Fast draft</option>
                      <option value="balanced">Balanced</option>
                      <option value="high">High quality</option>
                    </select>
                  </label>
                </div>

                <div className="video-switches">
                  <label className="toggle-row">
                    <input
                      checked={videoOptions.stabilize}
                      onChange={(event) => updateVideoOption("stabilize", event.target.checked)}
                      type="checkbox"
                    />
                    Stabilize camera shake
                  </label>
                  <label className="toggle-row">
                    <input
                      checked={videoOptions.addCaptions}
                      onChange={(event) => updateVideoOption("addCaptions", event.target.checked)}
                      type="checkbox"
                    />
                    <Captions size={17} />
                    Add captions
                  </label>
                  <label className="toggle-row">
                    <input
                      checked={videoOptions.removeBackground}
                      onChange={(event) => updateVideoOption("removeBackground", event.target.checked)}
                      type="checkbox"
                    />
                    Remove background
                  </label>
                </div>
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
                  <small>{referenceStatus}</small>
                </label>

                <div className="camera-stage">
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
                    <span>{fps.toFixed(0)} FPS</span>
                    <span>{frameLatencyMs.toFixed(1)} ms</span>
                    <span>face {Math.round(faceConfidence * 100)}%</span>
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
                    <select
                      value={trackingMode}
                      onChange={(event) => changeTrackingMode(event.target.value as "landmarks" | "motion")}
                    >
                      <option value="landmarks">Real face + hand landmarks</option>
                      <option value="motion">Simple motion fallback</option>
                    </select>
                  </label>

                  <label className="field">
                    Identity source
                    <select
                      value={fictionalIdentity}
                      onChange={(event) =>
                        setFictionalIdentity(event.target.value as "self" | "fictional" | "licensed")
                      }
                    >
                      <option value="self">My own face</option>
                      <option value="fictional">AI-generated or fictional character</option>
                      <option value="licensed">Licensed actor reference</option>
                    </select>
                  </label>

                  <label className="field">
                    Output mode
                    <select value="neural" disabled>
                      <option value="neural">Neural LivePortrait reenactment</option>
                    </select>
                  </label>

                  <label className="field range-field compact-range">
                    Smoothing: {smoothing.toFixed(2)}
                    <input
                      max="0.95"
                      min="0"
                      onChange={(event) => setSmoothing(Number(event.target.value))}
                      step="0.01"
                      type="range"
                      value={smoothing}
                    />
                  </label>

                  <label className="field range-field compact-range">
                    Motion strength: {motionIntensity.toFixed(1)}x
                    <input
                      max="1.6"
                      min="0.25"
                      onChange={(event) => setMotionIntensity(Number(event.target.value))}
                      step="0.05"
                      type="range"
                      value={motionIntensity}
                    />
                  </label>

                  <label className="toggle-row realtime-toggle">
                    <input
                      checked={lipRetargeting}
                      onChange={(event) => setLipRetargeting(event.target.checked)}
                      type="checkbox"
                    />
                    Neural lip and teeth retargeting
                  </label>

                  <label className="toggle-row realtime-toggle">
                    <input
                      checked={eyeRetargeting}
                      onChange={(event) => setEyeRetargeting(event.target.checked)}
                      type="checkbox"
                    />
                    Neural eye and blink retargeting
                  </label>

                  <label className="field range-field compact-range">
                    Head rotation: {headRotationStrength.toFixed(2)}
                    <input
                      max="1.45"
                      min="0"
                      onChange={(event) => setHeadRotationStrength(Number(event.target.value))}
                      step="0.05"
                      type="range"
                      value={headRotationStrength}
                    />
                  </label>

                  <label className="field range-field compact-range">
                    Left / right: {headYawStrength.toFixed(2)}
                    <input
                      max="1.75"
                      min="0"
                      onChange={(event) => setHeadYawStrength(Number(event.target.value))}
                      step="0.05"
                      type="range"
                      value={headYawStrength}
                    />
                  </label>

                  <label className="field range-field compact-range">
                    Up / down: {headPitchStrength.toFixed(2)}
                    <input
                      max="1.75"
                      min="0"
                      onChange={(event) => setHeadPitchStrength(Number(event.target.value))}
                      step="0.05"
                      type="range"
                      value={headPitchStrength}
                    />
                  </label>

                  <label className="field range-field compact-range">
                    Tilt: {headRollStrength.toFixed(2)}
                    <input
                      max="1.75"
                      min="0"
                      onChange={(event) => setHeadRollStrength(Number(event.target.value))}
                      step="0.05"
                      type="range"
                      value={headRollStrength}
                    />
                  </label>

                  <label className="field range-field compact-range">
                    Face position: {headTranslationStrength.toFixed(2)}
                    <input
                      max="1.6"
                      min="0"
                      onChange={(event) => setHeadTranslationStrength(Number(event.target.value))}
                      step="0.05"
                      type="range"
                      value={headTranslationStrength}
                    />
                  </label>
                </div>

                <div className={`neural-status ${neuralStatus}`}>
                  <Activity size={16} />
                  <div>
                    <strong>{neuralStatus === "streaming" ? "Neural renderer live" : "Neural renderer"}</strong>
                    <span>{neuralMessage}</span>
                  </div>
                </div>

                <div className="neural-debug">
                  <strong>Neural diagnostics</strong>
                  <span>Socket: {neuralDebug.socketState}</span>
                  <span>GPU ready: {neuralDebug.connected ? "yes" : "no"}</span>
                  <span>Sent: {neuralDebug.framesSent}</span>
                  <span>Received: {neuralDebug.framesReceived}</span>
                  <span>Rejected: {neuralDebug.framesRejected}</span>
                  <span>Buffer: {(neuralDebug.bufferedBytes / 1024).toFixed(0)} KB</span>
                  <span>Last step: {neuralDebug.lastSkipReason}</span>
                  <span>GPU says: {neuralDebug.lastServerMessage}</span>
                </div>

                {cameraError && <p className="error-message">{cameraError}</p>}

                <div className="button-row">
                  <button
                    className="secondary-action"
                    disabled={!liveEnabled && (!referenceImage || !consentConfirmed)}
                    onClick={liveEnabled ? stopCamera : startCamera}
                    type="button"
                  >
                    <Camera size={17} />
                    {liveEnabled ? "Stop camera" : "Start camera"}
                  </button>
                  <button className="secondary-action" disabled={!liveEnabled} onClick={calibrateFace} type="button">
                    <Crosshair size={17} />
                    Calibrate
                  </button>
                  <button className="secondary-action" onClick={resetCalibration} type="button">
                    <RotateCcw size={17} />
                    Reset calibration
                  </button>
                  <button className="secondary-action" onClick={resetFaceControls} type="button">
                    <ScanFace size={17} />
                    Reset controls
                  </button>
                </div>
              </div>
            )}

            <div className="upload-slot">
              {mode === "audio" ? (
                <Mic2 size={22} />
              ) : mode === "realtime" ? (
                <ScanFace size={22} />
              ) : mode === "video" ? (
                <Film size={22} />
              ) : (
                <ImagePlus size={22} />
              )}
              <span>
                {mode === "audio"
                  ? "Drop audio file or record from the browser"
                  : mode === "realtime"
                    ? "Neural portrait sessions can be recorded or streamed later"
                    : mode === "video"
                      ? "Video upload is prepared for AI editing jobs"
                      : "Drop source image or training photos here"}
              </span>
              <small>
                {mode === "audio"
                  ? "Audio upload and recording flow is scaffolded for MP3/WAV."
                  : mode === "realtime"
                    ? "Frames are regenerated by a GPU model instead of deforming the uploaded photograph."
                    : mode === "video"
                      ? "The next backend step is uploading this video to private storage before provider processing."
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
              <h2>{mode === "realtime" ? "Neural face output" : "Private gallery"}</h2>
              <span>{mode === "realtime" ? neuralStatus : `${generations.length} items`}</span>
            </div>

            {mode === "realtime" ? (
              <div className="avatar-output">
                <div className="ai-face neural-live">
                  {referenceImage || liveEnabled ? (
                    <>
                      <canvas
                        aria-label="Neural real-time face output"
                        className="face-output-canvas"
                        ref={outputCanvasRef}
                      />
                      <span className="ai-content-label">AI GENERATED LIVE</span>
                    </>
                  ) : (
                    <div className="photo-empty-state">
                      <ImagePlus size={34} />
                      <strong>Upload a reference photo first</strong>
                      <span>The GPU will encode this identity before the live session starts.</span>
                    </div>
                  )}
                </div>

                <div className="signal-strip">
                  <span>Neural FPS {neuralFps.toFixed(0)}</span>
                  <span>End-to-end {neuralLatencyMs.toFixed(1)} ms</span>
                  <span>Inference {neuralInferenceMs.toFixed(1)} ms</span>
                  <span>Smile {motion.smile.toFixed(2)}</span>
                  <span>Mouth {motion.mouth.toFixed(2)}</span>
                  <span>Face {Math.round(faceConfidence * 100)}%</span>
                  <span>Tracking {Math.round(trackingStrength * 100)}%</span>
                </div>

                <div className="pipeline-steps">
                  <span className={liveEnabled ? "done" : ""}>camera</span>
                  <span className={isCalibrated ? "done" : ""}>calibrated</span>
                  <span className={referenceImage ? "done" : ""}>{fictionalIdentity}</span>
                  <span className={neuralStatus === "streaming" ? "done" : ""}>LivePortrait GPU</span>
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
                    {item.type === "video" && item.metadata && (
                      <small className="asset-meta">
                        {String(item.metadata.mode ?? "edit")} - {String(item.metadata.aspectRatio ?? "original")} -{" "}
                        {String(item.metadata.quality ?? "balanced")}
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
