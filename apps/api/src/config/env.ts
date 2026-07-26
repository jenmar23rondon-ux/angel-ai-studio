import "dotenv/config";

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  webOrigins: (process.env.WEB_ORIGINS ?? process.env.WEB_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
  openaiTranscriptionModel: process.env.OPENAI_TRANSCRIPTION_MODEL ?? "whisper-1",
  openaiTtsModel: process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts",
  realtimeGpuUrl: process.env.REALTIME_GPU_URL ?? "",
  realtimeSessionSecret: process.env.REALTIME_SESSION_SECRET ?? ""
};

export const realtimeConfigured =
  /^wss?:\/\//.test(env.realtimeGpuUrl) && env.realtimeSessionSecret.length >= 32;
