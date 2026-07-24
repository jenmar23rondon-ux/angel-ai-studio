import {
  Activity,
  Camera,
  Crosshair,
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
  buildFaceTriangles,
  FaceMeshRenderer,
  type FaceConnection,
  type FacePoint,
  type FaceTriangle
} from "./realtime/faceMeshRenderer";
import { createGeneration, Generation, GenerationMode, listGenerations, VoiceOptions } from "./services/api";

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

const clamp = (value: number, min = -1, max = 1) => Math.max(min, Math.min(max, value));
const mediapipeVersion = "0.10.35";
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
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState("");
  const [recordedAudioName, setRecordedAudioName] = useState("");
  const [micError, setMicError] = useState("");
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [fps, setFps] = useState(0);
  const [frameLatencyMs, setFrameLatencyMs] = useState(0);
  const [avatarStyle, setAvatarStyle] = useState("live-swap");
  const [puppetZoom, setPuppetZoom] = useState(1);
  const [motionIntensity, setMotionIntensity] = useState(1);
  const [smoothing, setSmoothing] = useState(0.68);
  const [mouthStrength, setMouthStrength] = useState(0.9);
  const [eyeStrength, setEyeStrength] = useState(0.82);
  const [headRotationStrength, setHeadRotationStrength] = useState(0.72);
  const [maskFeathering, setMaskFeathering] = useState(12);
  const [facePositionX, setFacePositionX] = useState(0);
  const [facePositionY, setFacePositionY] = useState(0);
  const [preserveLiveMouth, setPreserveLiveMouth] = useState(true);
  const [fictionalIdentity, setFictionalIdentity] = useState("generated");
  const [expression, setExpression] = useState("natural");
  const [handGesture, setHandGesture] = useState("idle");
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
  const [consentConfirmed, setConsentConfirmed] = useState(true);
  const [generations, setGenerations] = useState<Generation[]>(samples);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const outputCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const loopSessionRef = useRef(0);
  const previousFrameRef = useRef<Uint8ClampedArray | null>(null);
  const faceLandmarkerRef = useRef<any>(null);
  const referenceLandmarkerRef = useRef<any>(null);
  const handLandmarkerRef = useRef<any>(null);
  const trackingReadyRef = useRef(false);
  const faceTrianglesRef = useRef<FaceTriangle[]>([]);
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
  const faceRendererRef = useRef<FaceMeshRenderer | null>(null);
  const metricsRef = useRef({
    frameCount: 0,
    frameWindowStartedAt: performance.now(),
    latencyTotal: 0,
    lastUiUpdateAt: 0
  });
  const audioStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  if (!faceRendererRef.current) {
    faceRendererRef.current = new FaceMeshRenderer();
  }

  const settingsRef = useRef({
    avatarStyle,
    cameraDrivenGestures,
    expression,
    eyeStrength,
    facePositionX,
    facePositionY,
    handGesture,
    headRotationStrength,
    maskFeathering,
    motionIntensity,
    mouthStrength,
    preserveLiveMouth,
    puppetZoom,
    smoothing,
    trackingMode
  });
  settingsRef.current = {
    avatarStyle,
    cameraDrivenGestures,
    expression,
    eyeStrength,
    facePositionX,
    facePositionY,
    handGesture,
    headRotationStrength,
    maskFeathering,
    motionIntensity,
    mouthStrength,
    preserveLiveMouth,
    puppetZoom,
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
    renderFaceOutput();
  }, [
    avatarStyle,
    eyeStrength,
    facePositionX,
    facePositionY,
    headRotationStrength,
    maskFeathering,
    motionIntensity,
    mouthStrength,
    preserveLiveMouth,
    puppetZoom,
    referenceImage
  ]);

  useEffect(() => {
    return () => {
      loopSessionRef.current += 1;
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
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
    cancelCameraLoop();
    streamRef.current?.getTracks().forEach((track) => track.stop());

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
      setTrackingLabel(trackingMode === "landmarks" ? "acquiring face" : "motion fallback");
      metricsRef.current = {
        frameCount: 0,
        frameWindowStartedAt: performance.now(),
        latencyTotal: 0,
        lastUiUpdateAt: 0
      };
      lastDetectionAtRef.current = 0;
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
    lastDetectionAtRef.current = 0;
    lastTrackingSampleRef.current = {
      faceScore: 0,
      handScore: 0,
      label: "waiting for camera"
    };
    smoothedMotionRef.current = defaultMotion;
    setMotion(defaultMotion);
    setTrackingLabel(trackingReadyRef.current ? "landmark engine ready" : "landmark engine idle");
    renderFaceOutput();
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

      faceTrianglesRef.current = buildFaceTriangles(
        FaceLandmarker.FACE_LANDMARKS_TESSELATION as FaceConnection[]
      );
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

    renderFaceOutput();
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
    const expressionBoost = settings.expression === "smile" ? 0.28 : settings.expression === "serious" ? -0.16 : 0;
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
        smile: clamp(0.2 + smileScore * 0.9 + mouthDistance * 0.35 + expressionBoost, 0.08, 1),
        blink: settings.expression === "blink" ? 1 : clamp(blinkScore * 1.4, 0, 1),
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
        hand:
          settings.handGesture === "wave" ? Math.max(0.92, handScore) : settings.handGesture === "point" ? 0.86 : handScore,
        touchX: clamp((0.5 - indexTip.x) * 2),
        touchY: clamp((indexTip.y - 0.5) * 2)
      };
    } else {
      nextMotion = {
        ...nextMotion,
        hand:
          settings.handGesture === "wave"
            ? 0.92
            : settings.handGesture === "point"
              ? 0.78
              : Math.max(0.05, nextMotion.hand * 0.9)
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
        const settings = settingsRef.current;
        const expressionBoost = settings.expression === "smile" ? 0.34 : settings.expression === "serious" ? -0.18 : 0;
        const cameraHand = centerY < height * 0.45 && strength > 0.18 ? 0.96 : Math.max(0.18, strength * 1.4);

        const nextMotion = {
          x: clamp(x),
          y: clamp(y),
          roll: clamp(x * 0.22, -0.35, 0.35),
          lean: clamp(strength * 0.28, 0, 0.5),
          proximity: clamp(strength * 1.6, 0.1, 1),
          smile: clamp(0.42 + expressionBoost + strength * 0.3, 0.12, 0.95),
          blink: settings.expression === "blink" ? 1 : Math.max(0, Math.sin(Date.now() / 700) > 0.965 ? 1 : 0),
          hand: settings.handGesture === "wave" ? 0.95 : settings.handGesture === "point" ? 0.72 : cameraHand,
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

  function renderFaceOutput() {
    const output = outputCanvasRef.current;
    if (!output) {
      return;
    }

    const settings = settingsRef.current;
    faceRendererRef.current?.render(
      output,
      smoothedFaceLandmarksRef.current ?? neutralFaceLandmarksRef.current,
      neutralFaceLandmarksRef.current,
      {
        eyeStrength: settings.eyeStrength,
        facePositionX: settings.facePositionX,
        facePositionY: settings.facePositionY,
        faceScale: settings.puppetZoom,
        fit: settings.avatarStyle === "fullbody" ? "contain" : "cover",
        headRotationStrength: settings.headRotationStrength,
        maskFeathering: settings.maskFeathering,
        mode: settings.avatarStyle === "photo" || settings.avatarStyle === "portrait" ? "photo-reenactment" : "live-swap",
        motionStrength: settings.motionIntensity,
        mouthStrength: settings.mouthStrength,
        preserveLiveMouth: settings.preserveLiveMouth
      },
      videoRef.current
    );
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
    setIsCalibrated(true);
    setCameraError("");
    setTrackingLabel("neutral pose calibrated");
    renderFaceOutput();
  }

  function resetCalibration() {
    neutralFaceLandmarksRef.current = null;
    smoothedFaceLandmarksRef.current = latestFaceLandmarksRef.current
      ? cloneLandmarks(latestFaceLandmarksRef.current)
      : null;
    setIsCalibrated(false);
    setTrackingLabel(liveEnabled ? "hold a neutral pose" : "calibration reset");
  }

  function resetFaceControls() {
    setSmoothing(0.68);
    setMotionIntensity(1);
    setMouthStrength(0.9);
    setEyeStrength(0.82);
    setHeadRotationStrength(0.72);
    setMaskFeathering(12);
    setPuppetZoom(1);
    setFacePositionX(0);
    setFacePositionY(0);
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

    setReferenceStatus("Analyzing reference face...");
    setCameraError("");
    const reader = new FileReader();
    reader.addEventListener("load", async () => {
      const source = typeof reader.result === "string" ? reader.result : "";
      if (!source) {
        return;
      }

      setReferenceImage(source);
      setFictionalIdentity("uploaded");
      setAvatarStyle("live-swap");
      const image = new Image();
      image.src = source;

      try {
        await image.decode();
        faceRendererRef.current?.setReference(image, [], []);
        window.requestAnimationFrame(renderFaceOutput);
        const ready = await initializeLandmarkTracking();
        const result = ready ? referenceLandmarkerRef.current?.detect(image) : null;
        const landmarks = result?.faceLandmarks?.[0] as FacePoint[] | undefined;

        if (!landmarks) {
          setReferenceStatus("No clear face found. Use a front-facing, well-lit photo.");
          setCameraError("The reference photo needs one clear, front-facing face.");
          return;
        }

        faceRendererRef.current?.setReference(image, landmarks, faceTrianglesRef.current);
        setReferenceStatus("Identity mapped. Your live camera keeps the body, hands, hair and background.");
        window.requestAnimationFrame(renderFaceOutput);
      } catch {
        faceRendererRef.current?.clearReference();
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
                    <select value={fictionalIdentity} onChange={(event) => setFictionalIdentity(event.target.value)}>
                      <option value="generated">AI-generated character</option>
                      <option value="uploaded">Uploaded fictional reference</option>
                      <option value="licensed">Licensed actor reference</option>
                    </select>
                  </label>

                  <label className="field">
                    Output mode
                    <select value={avatarStyle} onChange={(event) => setAvatarStyle(event.target.value)}>
                      <option value="live-swap">Live camera face swap</option>
                      <option value="photo">Reference photo reenactment</option>
                      <option value="portrait">Reference portrait close-up</option>
                      <option value="fullbody">Full camera + face swap</option>
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

                  <label className="field range-field compact-range">
                    Mouth strength: {mouthStrength.toFixed(2)}
                    <input
                      max="1.4"
                      min="0.35"
                      onChange={(event) => setMouthStrength(Number(event.target.value))}
                      step="0.05"
                      type="range"
                      value={mouthStrength}
                    />
                  </label>

                  <label className="field range-field compact-range">
                    Eye strength: {eyeStrength.toFixed(2)}
                    <input
                      max="1.3"
                      min="0.35"
                      onChange={(event) => setEyeStrength(Number(event.target.value))}
                      step="0.05"
                      type="range"
                      value={eyeStrength}
                    />
                  </label>

                  <label className="field range-field compact-range">
                    Head rotation: {headRotationStrength.toFixed(2)}
                    <input
                      max="1.2"
                      min="0.1"
                      onChange={(event) => setHeadRotationStrength(Number(event.target.value))}
                      step="0.05"
                      type="range"
                      value={headRotationStrength}
                    />
                  </label>

                  <label className="field range-field compact-range">
                    Mask feathering: {maskFeathering.toFixed(0)} px
                    <input
                      max="28"
                      min="2"
                      onChange={(event) => setMaskFeathering(Number(event.target.value))}
                      step="1"
                      type="range"
                      value={maskFeathering}
                    />
                  </label>

                  <label className="field range-field compact-range">
                    Face scale: {puppetZoom.toFixed(2)}x
                    <input
                      max="1.08"
                      min="0.92"
                      onChange={(event) => setPuppetZoom(Number(event.target.value))}
                      step="0.01"
                      type="range"
                      value={puppetZoom}
                    />
                  </label>

                  <label className="field range-field compact-range">
                    Face position X: {facePositionX.toFixed(2)}
                    <input
                      max="0.08"
                      min="-0.08"
                      onChange={(event) => setFacePositionX(Number(event.target.value))}
                      step="0.01"
                      type="range"
                      value={facePositionX}
                    />
                  </label>

                  <label className="field range-field compact-range">
                    Face position Y: {facePositionY.toFixed(2)}
                    <input
                      max="0.08"
                      min="-0.08"
                      onChange={(event) => setFacePositionY(Number(event.target.value))}
                      step="0.01"
                      type="range"
                      value={facePositionY}
                    />
                  </label>

                  <label className="toggle-row realtime-toggle">
                    <input
                      checked={preserveLiveMouth}
                      onChange={(event) => setPreserveLiveMouth(event.target.checked)}
                      type="checkbox"
                    />
                    Preserve live mouth interior for teeth and lip sync
                  </label>
                </div>

                {cameraError && <p className="error-message">{cameraError}</p>}

                <div className="button-row">
                  <button className="secondary-action" onClick={liveEnabled ? stopCamera : startCamera} type="button">
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
                    ? "Live swap keeps the camera frame and replaces only the tracked facial region."
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
                  {referenceImage || liveEnabled ? (
                    <canvas aria-label="Real-time face mesh output" className="face-output-canvas" ref={outputCanvasRef} />
                  ) : (
                    <div className="photo-empty-state">
                      <ImagePlus size={34} />
                      <strong>Upload a reference photo first</strong>
                      <span>The output will use your uploaded image instead of the drawn avatar.</span>
                    </div>
                  )}
                </div>

                <div className="signal-strip">
                  <span>FPS {fps.toFixed(0)}</span>
                  <span>Latency {frameLatencyMs.toFixed(1)} ms</span>
                  <span>Smile {motion.smile.toFixed(2)}</span>
                  <span>Mouth {motion.mouth.toFixed(2)}</span>
                  <span>Face {Math.round(faceConfidence * 100)}%</span>
                  <span>Tracking {Math.round(trackingStrength * 100)}%</span>
                </div>

                <div className="pipeline-steps">
                  <span className={liveEnabled ? "done" : ""}>camera</span>
                  <span className={isCalibrated ? "done" : ""}>calibrated</span>
                  <span className={referenceImage ? "done" : ""}>{fictionalIdentity}</span>
                  <span className={faceConfidence > 0.5 ? "done" : ""}>live face swap</span>
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
