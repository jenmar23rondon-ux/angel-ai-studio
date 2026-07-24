import { createHmac, randomUUID } from "node:crypto";
import { env, realtimeConfigured } from "../config/env.js";

const sessionLifetimeSeconds = 10 * 60;

type RealtimeSessionPayload = {
  aud: "realtime-face";
  exp: number;
  iat: number;
  nonce: string;
  referenceType: "self" | "fictional" | "licensed";
};

const encode = (value: string) => Buffer.from(value).toString("base64url");

export function createRealtimeSession(referenceType: RealtimeSessionPayload["referenceType"]) {
  if (!realtimeConfigured) {
    return null;
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: RealtimeSessionPayload = {
    aud: "realtime-face",
    exp: issuedAt + sessionLifetimeSeconds,
    iat: issuedAt,
    nonce: randomUUID(),
    referenceType
  };
  const encodedPayload = encode(JSON.stringify(payload));
  const signature = createHmac("sha256", env.realtimeSessionSecret).update(encodedPayload).digest("base64url");

  return {
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    provider: "faster-liveportrait",
    token: `${encodedPayload}.${signature}`,
    wsUrl: env.realtimeGpuUrl
  };
}
