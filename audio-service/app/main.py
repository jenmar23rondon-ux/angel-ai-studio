from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(title="angel-ai-studio audio service", version="0.1.0")


class VoiceJobRequest(BaseModel):
    prompt: str = Field(min_length=8, max_length=2000)
    voice_mode: str
    target_voice: str
    accent: str
    target_language: str
    emotion: str
    preserve_emotion: bool = True
    remove_noise: bool = True


@app.get("/health")
def health():
    return {"status": "ok", "service": "angel-ai-studio-audio-service"}


@app.post("/voice/jobs")
def create_voice_job(request: VoiceJobRequest):
    text_step = "translated-text" if request.voice_mode == "translation" else "same-text"

    return {
        "status": "queued",
        "provider": "mock",
        "pipeline": [
            "noise-removal" if request.remove_noise else "source-audio",
            request.voice_mode,
            text_step,
            "s3-output",
        ],
        "targetVoice": request.target_voice,
        "accent": request.accent,
        "targetLanguage": request.target_language,
        "emotion": request.emotion,
        "preserveEmotion": request.preserve_emotion,
    }
