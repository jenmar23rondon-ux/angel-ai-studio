import { Router } from "express";
import { convertVoice } from "../controllers/voice.controller.js";

export const voiceRouter = Router();

voiceRouter.post("/convert", convertVoice);
