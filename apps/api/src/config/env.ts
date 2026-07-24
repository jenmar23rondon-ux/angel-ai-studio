import "dotenv/config";

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  realtimeGpuUrl: process.env.REALTIME_GPU_URL ?? "",
  realtimeSessionSecret: process.env.REALTIME_SESSION_SECRET ?? ""
};

export const realtimeConfigured =
  /^wss?:\/\//.test(env.realtimeGpuUrl) && env.realtimeSessionSecret.length >= 32;
