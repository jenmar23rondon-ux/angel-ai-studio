from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter()


class ImageRequest(BaseModel):
    prompt: str = Field(min_length=8, max_length=2000)


@router.post("/generate")
def generate_image(request: ImageRequest):
    return {
        "status": "queued",
        "provider": "mock",
        "prompt": request.prompt,
        "watermark": "AI generated",
    }
