export type GenerationMode = "image" | "edit" | "avatar" | "video";

export type Generation = {
  id: string;
  type: GenerationMode;
  prompt: string;
  status: "queued" | "processing" | "completed" | "failed";
  outputUrl?: string;
  createdAt: string;
};

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export async function createGeneration(input: {
  type: GenerationMode;
  prompt: string;
  consentConfirmed: boolean;
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
