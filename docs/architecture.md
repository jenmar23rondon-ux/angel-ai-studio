# Architecture

angel-ai-studio is split into four runtime boundaries:

- `apps/web`: the private studio interface.
- `apps/api`: auth, validation, consent, signed uploads and job creation.
- `apps/worker`: async generation orchestration.
- `ai-service`: Python boundary for local or model-heavy image pipelines.

The MVP should integrate one external provider first. Additional providers stay behind worker adapters.
