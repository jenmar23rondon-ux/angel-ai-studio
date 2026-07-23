from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class EditRequest(BaseModel):
    source_file_id: str
    prompt: str


@router.post("/inpaint")
def inpaint(request: EditRequest):
    return {"status": "queued", "sourceFileId": request.source_file_id, "provider": "mock"}
