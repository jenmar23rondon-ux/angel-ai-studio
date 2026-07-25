export type GenerationMode = "image" | "edit" | "avatar" | "video" | "audio" | "realtime";

export type VoiceOptions = {
  voiceMode: "voice-conversion" | "accent" | "translation";
  targetVoice: string;
  accent: string;
  targetLanguage: string;
  emotion: string;
  preserveEmotion: boolean;
  removeNoise: boolean;
};

export type VideoOptions = {
  mode: "enhance" | "translate" | "background" | "style" | "shorts";
  targetLanguage: string;
  aspectRatio: "original" | "9:16" | "16:9" | "1:1";
  quality: "draft" | "balanced" | "high";
  stabilize: boolean;
  removeBackground: boolean;
  addCaptions: boolean;
};

export type Generation = {
  id: string;
  type: GenerationMode;
  prompt: string;
  status: "queued" | "processing" | "completed" | "failed";
  outputUrl?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type RealtimeFaceSession = {
  expiresAt: string;
  provider: "faster-liveportrait";
  token: string;
  wsUrl: string;
};

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export async function createGeneration(input: {
  type: GenerationMode;
  prompt: string;
  consentConfirmed: boolean;
  videoOptions?: VideoOptions;
  voiceOptions?: VoiceOptions;
}) {
  const response = await fetch(`${API_URL}/api/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as Generation;
}

export async function listGenerations() {
  const response = await fetch(`${API_URL}/api/generations`);

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as Generation[];
}

export async function createRealtimeFaceSession(input: {
  consentConfirmed: boolean;
  referenceType: "self" | "fictional" | "licensed";
}) {
  const response = await fetch(`${API_URL}/api/realtime/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "The neural renderer is unavailable.");
  }

  return (await response.json()) as RealtimeFaceSession;
}
