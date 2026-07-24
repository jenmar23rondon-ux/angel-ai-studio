FROM shaoguo/faster_liveportrait:v3

ARG FASTER_LIVEPORTRAIT_COMMIT=8aad3602177547aaa5e4beec0c3ef5b7944e7a1f

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt
RUN git clone https://github.com/warmshao/FasterLivePortrait.git \
    && cd FasterLivePortrait \
    && git checkout "${FASTER_LIVEPORTRAIT_COMMIT}"

WORKDIR /opt/FasterLivePortrait
COPY gpu-service/requirements.txt /tmp/neural-requirements.txt
RUN pip install --no-cache-dir -r /tmp/neural-requirements.txt

COPY gpu-service/app realtime_app
COPY gpu-service/scripts/start.sh /usr/local/bin/start-neural-face
RUN chmod +x /usr/local/bin/start-neural-face

ENV FLP_CONFIG=configs/trt_mp_infer.yaml
ENV PYTHONPATH=/opt/FasterLivePortrait
EXPOSE 9871

HEALTHCHECK --interval=30s --timeout=5s --start-period=10m --retries=3 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('PORT', '9871') + '/health', timeout=4)"

CMD ["/usr/local/bin/start-neural-face"]
