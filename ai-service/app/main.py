from fastapi import FastAPI
from app.api.health import router as health_router
from app.api.image import router as image_router
from app.api.avatar import router as avatar_router
from app.api.edit import router as edit_router

app = FastAPI(title="angel-ai-studio service", version="0.1.0")

app.include_router(health_router)
app.include_router(image_router, prefix="/image", tags=["image"])
app.include_router(avatar_router, prefix="/avatar", tags=["avatar"])
app.include_router(edit_router, prefix="/edit", tags=["edit"])
