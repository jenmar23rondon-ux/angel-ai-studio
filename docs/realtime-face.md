# Real-Time Face Lab

The real-time mode is designed for low-latency avatar sessions:

```text
Camera input
        -> face landmark tracking
        -> expression and head-pose stream
        -> AI avatar renderer
        -> delayed live preview or stream output
```

The current MVP runs fully in the browser and demonstrates:

- Camera permission and preview.
- Adjustable output delay.
- Avatar style selection.
- Expression controls.
- A right-side AI face preview that responds to gesture input.

Production options:

- MediaPipe Tasks Vision for browser face landmarks.
- LiveKit or WebRTC for real-time transport.
- A dedicated GPU service for generative face rendering.
- Consent checks and visible AI-content labeling before streaming.
