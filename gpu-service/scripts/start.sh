#!/usr/bin/env bash
set -euo pipefail

cd /opt/FasterLivePortrait

if [ ! -f checkpoints/liveportrait_onnx/appearance_feature_extractor.onnx ]; then
  huggingface-cli download warmshao/FasterLivePortrait --local-dir checkpoints
fi

if [[ "${FLP_CONFIG:-configs/trt_mp_infer.yaml}" == *"trt"* ]] && [ ! -f checkpoints/liveportrait_onnx/appearance_feature_extractor.trt ]; then
  bash scripts/all_onnx2trt.sh
fi

exec uvicorn realtime_app.server:app \
  --host 0.0.0.0 \
  --port "${PORT:-9871}" \
  --ws-max-size 16777216
