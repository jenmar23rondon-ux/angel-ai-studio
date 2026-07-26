import { Router } from "express";
import { env } from "../config/env.js";
import { convertVoice } from "../controllers/voice.controller.js";

export const voiceRouter = Router();

voiceRouter.get("/status", (_request, response) => {
  response.status(env.openaiApiKey ? 200 : 503).json({
    configured: Boolean(env.openaiApiKey),
    provider: env.openaiApiKey ? "openai" : null,
    transcriptionModel: env.openaiTranscriptionModel,
    ttsModel: env.openaiTtsModel
  });
});

voiceRouter.post("/convert", convertVoice);
