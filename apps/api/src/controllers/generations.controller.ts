import type { Request, Response } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { enqueueGeneration } from "../services/queue.service.js";
import { assertPromptAllowed } from "../services/moderation.service.js";

const createGenerationSchema = z.object({
  type: z.enum(["image", "edit", "avatar", "video"]),
  prompt: z.string().trim().min(8).max(2000),
  consentConfirmed: z.boolean()
});

type Generation = {
  id: string;
  type: "image" | "edit" | "avatar" | "video";
  prompt: string;
  status: "queued" | "processing" | "completed" | "failed";
  outputUrl?: string;
  createdAt: string;
};

const generations: Generation[] = [];

export async function createGeneration(request: Request, response: Response) {
  const input = createGenerationSchema.parse(request.body);

  if (!input.consentConfirmed) {
    response.status(400).json({ error: "Consent confirmation is required." });
    return;
  }

  assertPromptAllowed(input.prompt);

  const generation: Generation = {
    id: randomUUID(),
    type: input.type,
    prompt: input.prompt,
    status: "queued",
    createdAt: new Date().toISOString()
  };

  generations.unshift(generation);
  await enqueueGeneration(generation.id);

  response.status(201).json(generation);
}

export function listGenerations(_request: Request, response: Response) {
  response.json(generations);
}
