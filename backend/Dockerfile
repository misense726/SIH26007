FROM python:3.12-slim

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
RUN python -m pip install .

COPY --chown=fogsen:fogsen config ./config
COPY --chown=fogsen:fogsen maps ./maps

USER fogsen

EXPOSE 8000

HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=10 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=2).read()"]

CMD ["python", "-m", "uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]

