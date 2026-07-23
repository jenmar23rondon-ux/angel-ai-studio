export type GenerationMode = "image" | "edit" | "avatar" | "video" | "audio";

export type VoiceOptions = {
  voiceMode: "voice-conversion" | "accent" | "translation";
  targetVoice: string;
  accent: string;
  targetLanguage: string;
  emotion: string;
  preserveEmotion: boolean;
  removeNoise: boolean;
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

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export async function createGeneration(input: {
  type: GenerationMode;
  prompt: string;
  consentConfirmed: boolean;
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
