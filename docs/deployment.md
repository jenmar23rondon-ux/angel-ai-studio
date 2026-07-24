# Deployment

Recommended AWS targets:

- Web: S3 and CloudFront, or containerized Vite build behind CloudFront.
- API: ECS Fargate or App Runner.
- Worker: ECS Fargate service.
- Database: RDS PostgreSQL.
- Queue/cache: ElastiCache Redis or SQS depending on provider latency.
- Assets: private S3 bucket with server-generated signed URLs.

## Neural real-time face

Vercel and Railway do not replace the GPU renderer:

- Vercel hosts `apps/web`.
- Railway hosts `apps/api`, PostgreSQL, and Redis.
- A persistent RunPod GPU Pod (or equivalent NVIDIA host) runs `gpu-service`.

Set the following on the Railway API service:

```env
REALTIME_GPU_URL=wss://your-gpu-host.example/v1/realtime-face
REALTIME_SESSION_SECRET=use-at-least-32-random-characters
```

Set the same `REALTIME_SESSION_SECRET` on the GPU service. The OpenAI,
DeepSeek, and Gemini keys are unrelated to face reenactment.

`RUNPOD_API_KEY` is only needed if the Pod will be created or managed through
RunPod's API. It is not needed by the running face renderer.
