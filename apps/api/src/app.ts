import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env.js";
import { errorMiddleware } from "./middlewares/error.middleware.js";
import { generationsRouter } from "./routes/generations.routes.js";
import { realtimeRouter } from "./routes/realtime.routes.js";
import { voiceRouter } from "./routes/voice.routes.js";

export const app = express();

app.use(helmet());
app.use(cors({ origin: env.webOrigins }));
app.use(express.json({ limit: "15mb" }));

app.get("/health", (_request, response) => {
  response.json({ status: "ok", service: "angel-ai-studio-api" });
});

app.use("/api/generations", generationsRouter);
app.use("/api/realtime", realtimeRouter);
app.use("/api/voice", voiceRouter);
app.use(errorMiddleware);
