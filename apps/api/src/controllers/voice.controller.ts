import type { Request, Response } from "express";
import { z } from "zod";
import { convertVoiceWithOpenAI, VoiceProviderError } from "../services/openai-voice.service.js";

const voiceOptionsSchema = z.object({
  voiceMode: z.enum(["voice-conversion", "accent", "translation"]),
  targetVoice: z.string().trim().min(2).max(120),
  accent: z.string().trim().min(2).max(120),
  targetLanguage: z.string().trim().min(2).max(80),
  emotion: z.string().trim().min(2).max(80),
  preserveEmotion: z.boolean(),
  removeNoise: z.boolean()
});

const convertVoiceSchema = z.object({
  audioBase64: z.string().min(1).max(14_000_000),
  consentConfirmed: z.literal(true),
  fileName: z.string().trim().min(1).max(160),
  mimeType: z.string().trim().min(3).max(120),
  voiceOptions: voiceOptionsSchema
});

export async function convertVoice(request: Request, response: Response) {
  const input = convertVoiceSchema.safeParse(request.body);

  if (!input.success) {
    response.status(400).json({
      error: "A recording, consent and valid voice options are required."
    });
    return;
  }

  try {
    response.json(await convertVoiceWithOpenAI(input.data));
  } catch (error) {
    if (error instanceof VoiceProviderError) {
      response.status(error.statusCode).json({ error: error.message });
      return;
    }

    throw error;
  }
}
