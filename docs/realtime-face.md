# Real-Time Neural Face

The production real-time mode uses neural portrait reenactment. The browser no
longer deforms the uploaded photograph.

```text
Browser camera
    -> MediaPipe tracking and consent gate
    -> signed short-lived session from Railway API
    -> JPEG frames over a direct WebSocket
    -> FasterLivePortrait on NVIDIA TensorRT
    -> generated portrait frames
    -> browser canvas and optional recording/streaming
```

## Why the old renderer was removed

The previous renderer triangulated a static photograph and moved its pixels with
facial landmarks. It could not generate unseen mouth interiors, teeth, eyelids,
skin texture, or correct self-occlusion. Increasing smoothing or feathering
could hide seams but could not fix the missing visual information.

The canvas was being cleared and the camera loop was already guarded against
duplicates. The double face came from the compositing algorithm itself:

1. It drew the complete camera frame or unmodified reference as the base.
2. It removed an oval at the *target* landmark position.
3. It composited a separately triangulated reference face over that opening.
4. Live mode then composited camera mouth details over the warped mouth.

During translation, rotation, or mouth opening, the target oval and warped mask
did not cover the original facial pixels exactly. Both the original features
and the warped features therefore remained visible. The extra live-mouth pass
also produced duplicated lips and teeth. This was an architectural artifact,
not a missing `clearRect` or an accumulated `requestAnimationFrame`.

`apps/web/src/realtime/faceMeshRenderer.ts` has therefore been removed from the
application bundle. MediaPipe remains responsible for browser tracking and
metrics, while the neural model synthesizes the output.

## Services

- `apps/web`: captures camera frames, displays metrics, and renders only the
  generated neural result.
- `apps/api`: validates consent and issues a ten-minute HMAC-signed session.
- `gpu-service`: keeps one FasterLivePortrait model warm, encodes the reference
  once, smooths pose and expression values in latent space, and renders
  sequential frames over WebSocket.

The browser never receives the shared GPU secret. The API never proxies the
camera frames, which avoids an extra network hop.

## Required configuration

Railway API:

```env
REALTIME_GPU_URL=wss://your-gpu-host.example/v1/realtime-face
REALTIME_SESSION_SECRET=use-at-least-32-random-characters
```

GPU service:

```env
REALTIME_SESSION_SECRET=use-the-same-long-random-value
```

The Calibrate control resets temporal filters and captures the next camera
frame as the neutral neural pose. Late WebSocket frames are discarded by
sequence number so they cannot repaint over newer output.

OpenAI, DeepSeek, and Gemini API keys do not provide a face reenactment model
and are not used by this pipeline.

## GPU deployment

Use a persistent NVIDIA worker with at least 12 GB VRAM. FasterLivePortrait
reports 30+ FPS on an RTX 3090 using TensorRT. A warm persistent Pod is preferred
to scale-to-zero serverless because model and TensorRT cold starts interrupt live
sessions.

The Docker image uses FasterLivePortrait's MediaPipe configuration rather than
InsightFace detection models. Review all upstream model licenses before
commercial distribution.

## Safety

The API only issues sessions for self, fictional, or licensed references after
explicit consent. The UI visibly labels output as AI-generated. Production
deployments should also add authenticated users, audit logs, abuse reporting,
rate limits, and recording watermarks.
