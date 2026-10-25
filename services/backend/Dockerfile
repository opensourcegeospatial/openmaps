# syntax=docker/dockerfile:1
# Backend service - FastAPI application server
#
# Stages:
#   builder  compiles and installs the Python dependencies (needs the network:
#            apt, rustup, PyPI and the PyTorch CPU index)
#   base     the runtime without the app: Python, tini, curl, the non-root user
#            and the installed dependencies. Tagged openmaps-backend-base:<arch>
#            so an offline rebuild can lay the app on top of it with no network.
#   dev      base + the test and lint tools (requirements-dev.txt), for running
#            the unit tests on the host (openmaps-backend-dev:<arch>)
#   runtime  base + the app (the default target; what compose builds)

ARG PYTHON_VERSION=3.12
ARG TARGETARCH

# =============================================================================
# Stage 1: Builder - install Python dependencies
# =============================================================================
FROM python:${PYTHON_VERSION}-slim AS builder

# WITH_ML=false builds the slim image for thin deployments: no torch, no
# transformers, no Rust toolchain (tokenizers). The vendored model module is
# still copied; main.py degrades to the LLM or keyword generator when its
# import fails.
ARG WITH_ML=true

WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Rust (needed by tokenizers) — only for the ML build
RUN if [ "$WITH_ML" = "true" ]; then \
      curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y; \
    fi
ENV PATH="/root/.cargo/bin:${PATH}"

COPY requirements.txt requirements-ml.txt ./

RUN python -m pip install --upgrade pip setuptools wheel \
    && python -m pip install --no-cache-dir --prefix=/install -r requirements.txt

# --extra-index-url: torch is pinned to a "+cpu" build that only exists on the
# PyTorch CPU index (see requirements-ml.txt); everything else still comes from PyPI.
RUN if [ "$WITH_ML" = "true" ]; then \
      python -m pip install --no-cache-dir --prefix=/install \
        --extra-index-url https://download.pytorch.org/whl/cpu \
        -r requirements-ml.txt; \
    fi

# `packaging` is provided by the slim base image, so the --prefix install above
# marks it already-satisfied and never copies it into /install — but the runtime
# stage lacks it, which breaks `import transformers`. Force it into /install.
RUN python -m pip install --no-cache-dir --prefix=/install --ignore-installed "packaging>=20.0"

# =============================================================================
# Stage 2: Base - the runtime without the app (openmaps-backend-base:<arch>)
# =============================================================================
FROM python:${PYTHON_VERSION}-slim AS base

ARG TARGETARCH
ARG WITH_ML=true

LABEL maintainer="openmaps" \
      service="backend" \
      arch="${TARGETARCH}" \
      ml="${WITH_ML}"

# Install tini for proper signal handling (PID 1 / SIGTERM)
RUN apt-get update && apt-get install -y --no-install-recommends \
    tini \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd --gid 1000 appuser \
    && useradd --uid 1000 --gid 1000 --create-home --shell /bin/bash appuser

# Copy installed Python packages from builder
COPY --from=builder /install /usr/local

RUN mkdir -p /app && chown appuser:appuser /app
WORKDIR /app

# Environment configuration
# HF_HUB_OFFLINE/TRANSFORMERS_OFFLINE: belt and braces for hosts without
# internet access. The model is loaded with local_files_only=True, and this makes
# any stray hub lookup fail fast instead of hanging on a network that isn't there.
ENV PYTHONPATH=/app \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1

EXPOSE 8000

# Health check - hit the /config endpoint (liveness; the model loads in the
# background). start-period matches the compose healthcheck.
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
    CMD curl -f http://localhost:8000/config || exit 1

# Use tini as entrypoint for proper signal handling
ENTRYPOINT ["tini", "--"]

# Run via uvicorn
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

# Switch to non-root user
USER appuser

# =============================================================================
# Stage 3: Dev - base + test and lint tools (openmaps-backend-dev:<arch>)
# =============================================================================
# Runs the unit tests against a mounted checkout, offline too:
#   docker run --rm -v "$PWD/services/backend:/src" -w /src \
#     openmaps-backend-dev:amd64 python -m pytest -q -p no:cacheprovider
FROM base AS dev

USER root
COPY requirements-dev.txt /tmp/requirements-dev.txt
RUN python -m pip install --no-cache-dir -r /tmp/requirements-dev.txt \
    && rm /tmp/requirements-dev.txt
USER appuser

# =============================================================================
# Stage 4: Runtime - base + the application (the default target)
# =============================================================================
FROM base AS runtime

# The app is everything in this directory that .dockerignore lets through
# (tests, docs, caches and the virtualenv stay out), so a new module needs no
# change here. Dockerfile.offline copies it the same way.
COPY --chown=appuser:appuser . /app/
