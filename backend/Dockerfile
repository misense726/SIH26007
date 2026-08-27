# syntax=docker/dockerfile:1.7

FROM pytorch/pytorch:2.7.1-cuda12.8-cudnn9-runtime@sha256:c16f4c749e2d9e96878875cdf6cc45cddda1d1a36fddd371dd6f2360f1b6e2a2

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    FOGSEN_HOST=0.0.0.0 \
    FOGSEN_PORT=8000 \
    FOGSEN_CONFIG_DIR=/app/config

WORKDIR /app

RUN useradd --create-home --uid 10001 fogsen

COPY pyproject.toml README.md ./
COPY backend ./backend
RUN --mount=type=cache,target=/root/.cache/pip python -m pip install .

# Official DehazeFormer-MCT mixed-fog code and weights, pinned to the author's
# immutable Hugging Face Space revision. Runtime inference is fully local.
ADD --checksum=sha256:56712bf3bb949d5c4c5a068d8a301b8057179c828a5a1acfb813af373e8bf207 \
    https://huggingface.co/spaces/IDKiro/DehazeFormer_Demo/resolve/8e0b26c7732e2b0dc104f69c5ea30f913c878a89/models/dehazeformer.py \
    /opt/fogsen-model/models/dehazeformer.py
ADD --checksum=sha256:867a182c536425d41c877e90a277b2dcc3c40909f41bf17b199302da5a34df05 \
    https://huggingface.co/spaces/IDKiro/DehazeFormer_Demo/resolve/8e0b26c7732e2b0dc104f69c5ea30f913c878a89/models/__init__.py \
    /opt/fogsen-model/models/__init__.py
ADD --checksum=sha256:225ce2d00d1cd8f0a7aabf5dc09f020ee34636cc942aa8b1a87496506224e304 \
    https://huggingface.co/spaces/IDKiro/DehazeFormer_Demo/resolve/8e0b26c7732e2b0dc104f69c5ea30f913c878a89/saved_models/dehazeformer.pth \
    /opt/fogsen-model/dehazeformer.pth
ADD --checksum=sha256:86baa11328570d9f18851a9cbdd3ed03d9e9640a7f4365036aadde7fda170575 \
    https://huggingface.co/spaces/IDKiro/DehazeFormer_Demo/resolve/8e0b26c7732e2b0dc104f69c5ea30f913c878a89/LICENSE \
    /opt/fogsen-model/LICENSE
RUN chmod -R a=rX /opt/fogsen-model

COPY --chown=fogsen:fogsen config ./config
COPY --chown=fogsen:fogsen maps ./maps

USER fogsen

EXPOSE 8000

HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=10 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=2).read()"]

CMD ["python", "-m", "uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
