import { Router } from "express";
import { z } from "zod";
import { realtimeConfigured } from "../config/env.js";
import { createRealtimeSession } from "../services/realtime-session.service.js";

const sessionSchema = z.object({
  consentConfirmed: z.literal(true),
  referenceType: z.enum(["self", "fictional", "licensed"])
});

export const realtimeRouter = Router();

realtimeRouter.get("/status", (_request, response) => {
  response.status(realtimeConfigured ? 200 : 503).json({
    configured: realtimeConfigured,
    provider: realtimeConfigured ? "faster-liveportrait" : null
  });
});

realtimeRouter.post("/session", (request, response) => {
  const input = sessionSchema.safeParse(request.body);

  if (!input.success) {
    response.status(400).json({
      error: "Consent and a permitted reference type are required."
    });
    return;
  }

  const session = createRealtimeSession(input.data.referenceType);

  if (!session) {
    response.status(503).json({
      code: "NEURAL_RENDERER_NOT_CONFIGURED",
      error: "The neural face renderer is not configured yet."
    });
    return;
  }

  response.json(session);
});
