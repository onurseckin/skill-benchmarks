# syntax=docker/dockerfile:1.7-labs

# ==============================================================================
# Stage 1: Tool & Binary Downloader Stage
# ==============================================================================
FROM debian:trixie-slim AS binary-builder

ARG TARGETPLATFORM
ARG BUN_VERSION=1.4.0
ARG UV_VERSION=0.12.5

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    unzip \
    tar \
    xz-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /extracted

# Download and extract Bun (platform-aware)
RUN case "${TARGETPLATFORM}" in \
      "linux/amd64") BUN_ARCH="x64" ;; \
      "linux/arm64") BUN_ARCH="aarch64" ;; \
      *) BUN_ARCH="x64" ;; \
    esac && \
    curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-${BUN_ARCH}.zip" -o /tmp/bun.zip && \
    unzip -q /tmp/bun.zip -d /tmp/bun-dist && \
    mkdir -p /extracted/bin && \
    mv /tmp/bun-dist/bun-linux-${BUN_ARCH}/bun /extracted/bin/bun && \
    chmod +x /extracted/bin/bun && \
    ln -s /extracted/bin/bun /extracted/bin/bunx

# Download and extract Astral uv (platform-aware)
RUN case "${TARGETPLATFORM}" in \
      "linux/amd64") UV_ARCH="x86_64-unknown-linux-gnu" ;; \
      "linux/arm64") UV_ARCH="aarch64-unknown-linux-gnu" ;; \
      *) UV_ARCH="x86_64-unknown-linux-gnu" ;; \
    esac && \
    curl -fsSL "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${UV_ARCH}.tar.gz" -o /tmp/uv.tar.gz && \
    tar -xzf /tmp/uv.tar.gz -C /tmp && \
    mv /tmp/uv-${UV_ARCH}/uv /extracted/bin/uv && \
    mv /tmp/uv-${UV_ARCH}/uvx /extracted/bin/uvx && \
    chmod +x /extracted/bin/uv /extracted/bin/uvx

# ==============================================================================
# Stage 2: Final Runtime Image
# ==============================================================================
FROM debian:trixie-slim AS sandbox-base

LABEL maintainer="infrastructure@skill-benchmarks.dev"
LABEL description="Deterministic Dual-Runtime Sandbox for Skill Benchmarking"
LABEL version="1.0.0"

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

# 1. Install base OS dependencies, Node.js repository, Python, and CLI utilities
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list \
    && apt-get update && apt-get install -y --no-install-recommends \
    bash \
    git \
    nodejs \
    python3 \
    python3-pip \
    python3-venv \
    python3-dev \
    ripgrep \
    fd-find \
    jq \
    tar \
    gzip \
    unzip \
    bzip2 \
    patch \
    make \
    gcc \
    g++ \
    procps \
    psmisc \
    coreutils \
    sed \
    gawk \
    && ln -s /usr/bin/fdfind /usr/local/bin/fd \
    && npm install -g pnpm@11.23.0 corepack \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# 2. Copy binaries from builder stage
COPY --from=binary-builder /extracted/bin/bun /usr/local/bin/bun
COPY --from=binary-builder /extracted/bin/bunx /usr/local/bin/bunx
COPY --from=binary-builder /extracted/bin/uv /usr/local/bin/uv
COPY --from=binary-builder /extracted/bin/uvx /usr/local/bin/uvx

# 3. Create sandbox non-root user and directories
ARG USERNAME=sandbox
ARG USER_UID=1000
ARG USER_GID=1000

RUN groupadd --gid ${USER_GID} ${USERNAME} \
    && useradd --uid ${USER_UID} --gid ${USER_GID} --create-home --shell /bin/bash ${USERNAME} \
    && mkdir -p /workspace /home/${USERNAME}/.cache /home/${USERNAME}/.npm /home/${USERNAME}/.bun \
    && chown -R ${USERNAME}:${USERNAME} /workspace /home/${USERNAME}

# 4. Configure Git identity for deterministic commits inside sandboxes
USER ${USERNAME}
WORKDIR /home/${USERNAME}

RUN git config --global user.name "Skill Benchmark Sandbox" \
    && git config --global user.email "sandbox@skill-benchmarks.dev" \
    && git config --global init.defaultBranch main \
    && git config --global advice.detachedHead false

# 5. Environment configuration
ENV USER=${USERNAME}
ENV HOME=/home/${USERNAME}
ENV WORKSPACE=/workspace
ENV PATH=/home/${USERNAME}/.local/bin:/usr/local/bin:/usr/bin:/bin

# 6. Copy environment verification script and execution wrapper
USER root
COPY --chmod=0755 verify-env.sh /usr/local/bin/verify-env.sh
COPY --chmod=0755 exec-wrapper.sh /usr/local/bin/exec-wrapper.sh
USER ${USERNAME}

WORKDIR /workspace

# Keep container idle and responsive for incoming exec invocations
CMD ["sleep", "infinity"]
