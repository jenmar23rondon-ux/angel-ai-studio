import asyncio
import base64
import hashlib
import hmac
import json
import os
import struct
import tempfile
import time
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from omegaconf import OmegaConf
from src.pipelines.faster_live_portrait_pipeline import FasterLivePortraitPipeline
from src.utils.utils import get_rotation_matrix

FRAME_HEADER = struct.Struct("<Id")
MAX_REFERENCE_BYTES = 10 * 1024 * 1024
SESSION_SECRET = os.environ.get("REALTIME_SESSION_SECRET", "")
CONFIG_PATH = os.environ.get("FLP_CONFIG", "configs/trt_mp_infer.yaml")
JPEG_QUALITY = int(os.environ.get("OUTPUT_JPEG_QUALITY", "90"))
OUTPUT_MAX_DIM = int(os.environ.get("OUTPUT_MAX_DIM", "768"))

app = FastAPI(title="angel-ai-studio neural face renderer", version="1.0.0")


class StableLivePortraitPipeline(FasterLivePortraitPipeline):
    def init_vars(self, **kwargs: Any) -> None:
        super().init_vars(**kwargs)
        self.temporal_smoothing = 0.68
        self.head_rotation_strength = 0.9
        self.motion_ema: dict[str, np.ndarray] | None = None
        self.eye_ema: np.ndarray | None = None
        self.lip_ema: np.ndarray | None = None

    def set_temporal_smoothing(self, amount: float) -> None:
        self.temporal_smoothing = min(0.95, max(0.0, amount))

    def set_head_rotation_strength(self, amount: float) -> None:
        self.head_rotation_strength = min(1.25, max(0.0, amount))

    def _run(
        self,
        src_info: Any,
        x_d_i_info: dict[str, np.ndarray],
        x_d_0_info: dict[str, np.ndarray],
        R_d_i: np.ndarray,
        R_d_0: np.ndarray,
        realtime: bool,
        input_eye_ratio: np.ndarray,
        input_lip_ratio: np.ndarray,
        I_p_pstbk: Any,
        **kwargs: Any,
    ) -> Any:
        # Smooth latent pose and expression values, not output pixels. This avoids
        # frame blending and the ghosting it would introduce around lips and eyes.
        pose_alpha = 1.0 - self.temporal_smoothing * 0.75
        expression_alpha = min(1.0, pose_alpha * 1.45)
        current = {
            key: value.copy()
            for key, value in x_d_i_info.items()
            if isinstance(value, np.ndarray) and key != "R"
        }
        for key in ("pitch", "yaw", "roll"):
            neutral = x_d_0_info[key]
            current[key] = neutral + (current[key] - neutral) * self.head_rotation_strength

        if self.motion_ema is None:
            self.motion_ema = current
            self.eye_ema = input_eye_ratio.copy()
            self.lip_ema = input_lip_ratio.copy()
        else:
            for key, value in current.items():
                alpha = expression_alpha if key in {"exp", "kp"} else pose_alpha
                self.motion_ema[key] += (value - self.motion_ema[key]) * alpha
            self.eye_ema += (input_eye_ratio - self.eye_ema) * expression_alpha
            self.lip_ema += (input_lip_ratio - self.lip_ema) * expression_alpha

        smoothed = {key: value.copy() for key, value in self.motion_ema.items()}
        smoothed_rotation = get_rotation_matrix(
            smoothed["pitch"],
            smoothed["yaw"],
            smoothed["roll"],
        )
        smoothed["R"] = smoothed_rotation
        return super()._run(
            src_info,
            smoothed,
            x_d_0_info,
            smoothed_rotation,
            R_d_0,
            realtime,
            self.eye_ema,
            self.lip_ema,
            I_p_pstbk,
            **kwargs,
        )


pipeline: StableLivePortraitPipeline | None = None
pipeline_lock = asyncio.Lock()
model_error = ""


def decode_base64url(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def verify_session_token(token: str) -> dict[str, Any]:
    if not SESSION_SECRET:
        raise ValueError("REALTIME_SESSION_SECRET is not configured")

    try:
        encoded_payload, signature = token.split(".", 1)
        expected = hmac.new(
            SESSION_SECRET.encode("utf-8"),
            encoded_payload.encode("utf-8"),
            hashlib.sha256,
        ).digest()
        supplied = decode_base64url(signature)
        if not hmac.compare_digest(expected, supplied):
            raise ValueError("invalid session signature")

        payload = json.loads(decode_base64url(encoded_payload))
    except (ValueError, json.JSONDecodeError) as error:
        raise ValueError("invalid session token") from error

    if payload.get("aud") != "realtime-face":
        raise ValueError("invalid session audience")
    if int(payload.get("exp", 0)) <= int(time.time()):
        raise ValueError("session expired")
    if payload.get("referenceType") not in {"self", "fictional", "licensed"}:
        raise ValueError("reference type is not permitted")

    return payload


def decode_reference(data_url: str) -> bytes:
    try:
        header, encoded = data_url.split(",", 1)
    except ValueError as error:
        raise ValueError("invalid reference image") from error

    if not header.startswith("data:image/"):
        raise ValueError("reference must be an image")

    raw = base64.b64decode(encoded, validate=True)
    if not raw or len(raw) > MAX_REFERENCE_BYTES:
        raise ValueError("reference image exceeds the 10 MB limit")
    return raw


def configure_pipeline(options: dict[str, Any], reset_session: bool) -> None:
    assert pipeline is not None
    smoothing = min(0.95, max(0.0, float(options.get("smoothing", 0.68))))
    motion_strength = min(1.5, max(0.5, float(options.get("motionStrength", 1.0))))
    if reset_session:
        pipeline.init_vars()
    pipeline.set_temporal_smoothing(smoothing)
    pipeline.set_head_rotation_strength(
        float(options.get("headRotationStrength", 0.9))
    )
    pipeline.update_cfg(
        {
            "driving_multiplier": motion_strength,
            "flag_crop_driving_video": True,
            "flag_eye_retargeting": bool(options.get("eyeRetargeting", True)),
            "flag_lip_retargeting": bool(options.get("lipRetargeting", True)),
            "flag_normalize_lip": True,
            "flag_pasteback": True,
            "flag_relative_motion": True,
            "flag_stitching": True,
        }
    )


def prepare_reference(reference_bytes: bytes) -> str:
    assert pipeline is not None
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as reference_file:
        reference_file.write(reference_bytes)
        reference_path = reference_file.name

    try:
        prepared = pipeline.prepare_source(reference_path, realtime=True)
        if not prepared:
            raise ValueError("no clear face was found in the reference")
        return reference_path
    except Exception:
        Path(reference_path).unlink(missing_ok=True)
        raise


def render_frame(frame_bytes: bytes, first_frame: bool) -> tuple[bytes, float]:
    assert pipeline is not None
    encoded = np.frombuffer(frame_bytes, dtype=np.uint8)
    driving_frame = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    if driving_frame is None:
        raise ValueError("invalid camera frame")

    started_at = time.perf_counter()
    _driving_crop, output_crop, output_original, _motion = pipeline.run(
        driving_frame,
        pipeline.src_imgs[0],
        pipeline.src_infos[0],
        first_frame=first_frame,
    )
    inference_ms = (time.perf_counter() - started_at) * 1000

    if output_crop is None:
        raise ValueError("face tracking was lost")

    output = output_original if output_original is not None else output_crop
    output_bgr = cv2.cvtColor(output, cv2.COLOR_RGB2BGR)
    height, width = output_bgr.shape[:2]
    if max(height, width) > OUTPUT_MAX_DIM:
        scale = OUTPUT_MAX_DIM / max(height, width)
        output_bgr = cv2.resize(
            output_bgr,
            (round(width * scale), round(height * scale)),
            interpolation=cv2.INTER_AREA,
        )
    success, jpeg = cv2.imencode(
        ".jpg",
        output_bgr,
        [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY],
    )
    if not success:
        raise RuntimeError("could not encode neural frame")

    return jpeg.tobytes(), inference_ms


@app.on_event("startup")
async def load_model() -> None:
    global pipeline, model_error
    try:
        config = OmegaConf.load(CONFIG_PATH)
        config.infer_params.flag_pasteback = True
        pipeline = await asyncio.to_thread(
            StableLivePortraitPipeline,
            cfg=config,
            is_animal=False,
        )
    except Exception as error:
        model_error = str(error)
        pipeline = None


@app.get("/health")
def health() -> JSONResponse:
    ready = pipeline is not None
    return JSONResponse(
        status_code=200 if ready else 503,
        content={
            "model": "faster-liveportrait",
            "ready": ready,
            "error": model_error or None,
        },
    )


@app.websocket("/v1/realtime-face")
async def realtime_face(websocket: WebSocket) -> None:
    token = websocket.query_params.get("token", "")
    try:
        token_payload = verify_session_token(token)
    except ValueError as error:
        await websocket.close(code=4401, reason=str(error))
        return

    if pipeline is None:
        await websocket.close(code=1013, reason="neural model is not ready")
        return
    if pipeline_lock.locked():
        await websocket.close(code=1013, reason="GPU renderer is busy")
        return

    await websocket.accept()
    reference_path = ""

    async with pipeline_lock:
        try:
            init_message = await asyncio.wait_for(websocket.receive_text(), timeout=15)
            init = json.loads(init_message)
            if init.get("type") != "init" or init.get("consentConfirmed") is not True:
                raise ValueError("consent-confirmed init message required")
            if init.get("referenceType") != token_payload.get("referenceType"):
                raise ValueError("reference type does not match the session")

            configure_pipeline(init.get("options", {}), reset_session=True)
            reference_bytes = decode_reference(init.get("referenceImage", ""))
            reference_path = await asyncio.to_thread(prepare_reference, reference_bytes)
            await websocket.send_json(
                {
                    "type": "ready",
                    "message": "LivePortrait identity encoded",
                }
            )

            first_frame = True
            rendered_frames = 0
            metrics_started_at = time.perf_counter()

            while True:
                message = await websocket.receive()
                if message["type"] == "websocket.disconnect":
                    break
                if message.get("text"):
                    control = json.loads(message["text"])
                    if control.get("type") == "options":
                        configure_pipeline(
                            control.get("options", {}),
                            reset_session=False,
                        )
                        await websocket.send_json(
                            {
                                "type": "options",
                                "message": "Neural controls updated",
                            }
                        )
                    elif control.get("type") == "calibrate":
                        pipeline.motion_ema = None
                        pipeline.eye_ema = None
                        pipeline.lip_ema = None
                        first_frame = True
                        await websocket.send_json(
                            {
                                "type": "calibrated",
                                "message": "Neutral pose will be captured on the next frame",
                            }
                        )
                    continue

                packet = message.get("bytes", b"")
                if len(packet) <= FRAME_HEADER.size:
                    continue

                sequence, captured_at = FRAME_HEADER.unpack_from(packet)
                frame_bytes = packet[FRAME_HEADER.size :]

                try:
                    neural_jpeg, inference_ms = await asyncio.to_thread(
                        render_frame,
                        frame_bytes,
                        first_frame,
                    )
                except ValueError as error:
                    await websocket.send_json({"type": "tracking", "message": str(error)})
                    continue

                first_frame = False
                rendered_frames += 1
                await websocket.send_bytes(
                    FRAME_HEADER.pack(sequence, captured_at) + neural_jpeg
                )

                elapsed = time.perf_counter() - metrics_started_at
                if rendered_frames % 10 == 0 and elapsed > 0:
                    await websocket.send_json(
                        {
                            "type": "metrics",
                            "inferenceMs": round(inference_ms, 2),
                            "serverFps": round(rendered_frames / elapsed, 2),
                        }
                    )
                    rendered_frames = 0
                    metrics_started_at = time.perf_counter()
        except (WebSocketDisconnect, asyncio.TimeoutError):
            pass
        except Exception as error:
            await websocket.send_json({"type": "error", "error": str(error)})
        finally:
            if reference_path:
                Path(reference_path).unlink(missing_ok=True)
