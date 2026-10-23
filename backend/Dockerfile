# uv matches the version that wrote uv.lock; uv 0.12 images are built on Debian trixie
FROM ghcr.io/astral-sh/uv:0.12-python3.13-trixie-slim

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_NO_DEV=1

# API dependencies only (the satellite pipeline group runs offline, not in production)
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --locked --no-install-project --no-group pipeline

COPY src ./src
COPY data ./data
COPY chain ./chain
RUN uv sync --locked --no-group pipeline

EXPOSE 8000
CMD ["uv", "run", "--no-sync", "uvicorn", "regrow_api.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*", "--no-access-log"]
