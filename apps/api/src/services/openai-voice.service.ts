import { env } from "../config/env.js";

export type VoiceOptions = {
  voiceMode: "voice-conversion" | "accent" | "translation";
  targetVoice: string;
  accent: string;
  targetLanguage: string;
  emotion: string;
  preserveEmotion: boolean;
  removeNoise: boolean;
};

export type VoiceConversionInput = {
  audioBase64: string;
  fileName: string;
  mimeType: string;
  voiceOptions: VoiceOptions;
};

export class VoiceProviderError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

const openaiUrl = "https://api.openai.com/v1";

const voiceMap: Record<string, string> = {
  "adult man": "onyx",
  "adult woman": "nova",
  "old man": "ash",
  "old woman": "shimmer",
  boy: "echo",
  girl: "coral",
  "designed studio voice": "sage",
  "warm narrator": "fable",
  "clear assistant": "alloy"
};

function getOpenAiVoice(targetVoice: string) {
  return voiceMap[targetVoice.toLowerCase()] ?? "alloy";
}

function getAccentInstruction(options: VoiceOptions) {
  const mode =
    options.voiceMode === "translation"
      ? `Translate the text into ${options.targetLanguage}. The final spoken text must be entirely in ${options.targetLanguage}, even if the source language is different.`
      : options.voiceMode === "accent"
        ? "Keep the original language and words as much as possible."
        : "Keep the original language and meaning.";

  return [
    mode,
    `Use a natural ${options.accent} accent.`,
    `Speak as a ${options.targetVoice.toLowerCase()} with a ${options.emotion.toLowerCase()} delivery.`,
    options.preserveEmotion ? "Preserve rhythm, intent and emotion from the source." : "Prioritize clean diction over the original emotion.",
    options.removeNoise ? "Ignore background noise or repeated artifacts from the transcript." : "Keep natural spoken texture."
  ].join(" ");
}

async function readOpenAiError(response: Response) {
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? `${response.status} ${response.statusText}`;
}

async function fetchOpenAiJson<T>(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${openaiUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.openaiApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new VoiceProviderError(response.status, await readOpenAiError(response));
  }

  return (await response.json()) as T;
}

export async function convertVoiceWithOpenAI(input: VoiceConversionInput) {
  if (!env.openaiApiKey) {
    throw new VoiceProviderError(503, "OPENAI_API_KEY is missing on the API service.");
  }

  const audioBuffer = Buffer.from(input.audioBase64, "base64");
  if (audioBuffer.byteLength < 512) {
    throw new VoiceProviderError(400, "The recorded audio is too small to convert.");
  }

  const formData = new FormData();
  formData.append("file", new Blob([audioBuffer], { type: input.mimeType }), input.fileName);
  formData.append("model", env.openaiTranscriptionModel);
  formData.append("response_format", "json");

  const transcriptionResponse = await fetch(`${openaiUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.openaiApiKey}` },
    body: formData
  });

  if (!transcriptionResponse.ok) {
    throw new VoiceProviderError(transcriptionResponse.status, await readOpenAiError(transcriptionResponse));
  }

  const transcription = (await transcriptionResponse.json()) as { text?: string };
  const transcript = transcription.text?.trim() ?? "";
  if (!transcript) {
    throw new VoiceProviderError(422, "The audio was received, but no speech could be transcribed.");
  }

  const styleInstruction = getAccentInstruction(input.voiceOptions);
  const chat = await fetchOpenAiJson<{ choices?: Array<{ message?: { content?: string } }> }>("/chat/completions", {
    model: env.openaiModel,
    messages: [
      {
        role: "system",
        content:
          "You prepare short spoken scripts for AI text-to-speech. Return only the final words to speak, with no labels, markdown, commentary, source text, or translation notes."
      },
      {
        role: "user",
        content: `${styleInstruction}

Rules:
- If the mode asks for translation, do not leave the result in the source language.
- Preserve names, brands and numbers.
- Keep the result natural for spoken audio.

Source transcript:
${transcript}`
      }
    ],
    temperature: 0.35
  });

  const spokenText = chat.choices?.[0]?.message?.content?.trim() || transcript;
  const speechResponse = await fetch(`${openaiUrl}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.openaiApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.openaiTtsModel,
      voice: getOpenAiVoice(input.voiceOptions.targetVoice),
      input: spokenText,
      instructions: styleInstruction,
      response_format: "mp3"
    })
  });

  if (!speechResponse.ok) {
    throw new VoiceProviderError(speechResponse.status, await readOpenAiError(speechResponse));
  }

  return {
    accentInstruction: styleInstruction,
    outputAudioBase64: Buffer.from(await speechResponse.arrayBuffer()).toString("base64"),
    outputMimeType: "audio/mpeg",
    provider: "openai",
    transcript,
    translatedText: spokenText,
    voiceUsed: getOpenAiVoice(input.voiceOptions.targetVoice)
  };
}
