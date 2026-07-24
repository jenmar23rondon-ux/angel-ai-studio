# Neural real-time face renderer

This service replaces the browser face-warp renderer with FasterLivePortrait
running on NVIDIA TensorRT. It accepts a reference portrait once and then
streams camera frames over a signed WebSocket session.

## Runtime requirements

- NVIDIA GPU with at least 12 GB VRAM.
- A persistent worker or Pod. Scale-to-zero serverless workers add cold-start
  delay and are not recommended for live sessions.
- A public TLS endpoint that forwards WebSocket traffic to port `9871`.
- A persistent volume mounted at
  `/opt/FasterLivePortrait/checkpoints` to avoid rebuilding TensorRT engines.

## Environment

```env
REALTIME_SESSION_SECRET=the-same-32-character-minimum-secret-used-by-the-api
PORT=9871
OUTPUT_JPEG_QUALITY=90
OUTPUT_MAX_DIM=768
```

The WebSocket path is `/v1/realtime-face`. Configure Railway with:

```env
REALTIME_GPU_URL=wss://your-gpu-host.example/v1/realtime-face
REALTIME_SESSION_SECRET=the-same-32-character-minimum-secret-used-by-the-api
```

The service uses FasterLivePortrait's MediaPipe configuration, avoiding the
non-commercial InsightFace detection models. Review all upstream model licenses
before commercial distribution.

`GET /health` returns `200` only after the model has loaded successfully and
`503` if model initialization failed.
