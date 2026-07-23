from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class AvatarRequest(BaseModel):
    profile_id: str
    style_prompt: str


@router.post("/generate")
def generate_avatar(request: AvatarRequest):
    return {"status": "queued", "profileId": request.profile_id, "provider": "mock"}
