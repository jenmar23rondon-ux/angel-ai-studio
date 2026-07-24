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
- Camera-frame motion tracking that drives the avatar in real time.
- Zero-delay browser-side photo motion.
- Avatar style selection.
- Fictional or AI-generated avatar reference upload.
- Expression controls.
- Basic hand gesture controls.
- A layered photo puppet preview that uses the uploaded image as the output and moves face, cheeks, hair and body regions separately.

Production options:

- MediaPipe Tasks Vision for browser face landmarks.
- LiveKit or WebRTC for real-time transport.
- A dedicated GPU service for generative face rendering.
- Consent checks and visible AI-content labeling before streaming.
- Reference validation that rejects celebrity or private-person impersonation.
