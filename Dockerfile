# 1. Use Node 22 (Bookworm Slim is recommended for size + compatibility)
FROM --platform=linux/amd64 node:20-bookworm-slim

# Arguments
ARG N8N_VERSION=latest
ARG LAUNCHER_VERSION=1.1.1

# Environment variables
ENV N8N_VERSION=${N8N_VERSION}
ENV NODE_ENV=production
ENV N8N_RELEASE_TYPE=stable
ENV SHELL /bin/sh

# IMPORTANT: Tell n8n where to look for your custom node
# n8n will scan this folder for packages
ENV N8N_CUSTOM_EXTENSIONS=/home/node/.n8n/custom

# 2. Install System Dependencies
# - python3, make, g++, build-essential: REQUIRED for ibm_db compilation
# - libaio1, libxml2: REQUIRED runtime libraries for IBM DB2
RUN apt-get update && apt-get install -y --no-install-recommends \
    tini \
    wget \
    python3 \
    make \
    g++ \
    build-essential \
    ca-certificates \
    libaio1 \
    libxml2 \
    && rm -rf /var/lib/apt/lists/*

# 3. Install n8n and pnpm
RUN set -eux; \
    npm install -g --omit=dev n8n@${N8N_VERSION} --ignore-scripts && \
    npm install -g pnpm && \
    rm -rf /usr/local/lib/node_modules/n8n/node_modules/@n8n/chat && \
    rm -rf /usr/local/lib/node_modules/n8n/node_modules/@n8n/design-system && \
    rm -rf /usr/local/lib/node_modules/n8n/node_modules/n8n-editor-ui/node_modules && \
    rm -rf /root/.npm

# 4. Setup Task Runner Launcher
COPY n8n-task-runners.json /etc/n8n-task-runners.json

RUN \
    ARCH=$(dpkg --print-architecture); \
    if [ "$ARCH" = "amd64" ]; then ARCH_NAME="amd64"; \
    elif [ "$ARCH" = "arm64" ]; then ARCH_NAME="arm64"; \
    else echo "Unsupported architecture: $ARCH"; exit 1; fi; \
    \
    mkdir /launcher-temp && \
    cd /launcher-temp && \
    wget -q https://github.com/n8n-io/task-runner-launcher/releases/download/${LAUNCHER_VERSION}/task-runner-launcher-${LAUNCHER_VERSION}-linux-${ARCH_NAME}.tar.gz && \
    wget -q https://github.com/n8n-io/task-runner-launcher/releases/download/${LAUNCHER_VERSION}/task-runner-launcher-${LAUNCHER_VERSION}-linux-${ARCH_NAME}.tar.gz.sha256 && \
    echo "$(cat task-runner-launcher-${LAUNCHER_VERSION}-linux-${ARCH_NAME}.tar.gz.sha256) task-runner-launcher-${LAUNCHER_VERSION}-linux-${ARCH_NAME}.tar.gz" > checksum.sha256 && \
    sha256sum -c checksum.sha256 && \
    tar xvf task-runner-launcher-${LAUNCHER_VERSION}-linux-${ARCH_NAME}.tar.gz --directory=/usr/local/bin && \
    cd - && \
    rm -r /launcher-temp

# 5. Setup Directories and Permissions
COPY docker-entrypoint.sh /
RUN chmod +x /docker-entrypoint.sh && \
    mkdir -p /home/node/.n8n/custom && \
    chown -R node:node /home/node/.n8n

ENV N8N_CUSTOM_EXTENSIONS=/home/node/.n8n/custom

USER root
RUN mkdir -p /home/node/.n8n/custom/n8n-nodes-db2-sql-builder \
 && chown -R node:node /home/node/.n8n
USER node

# Copy ONLY compiled JS + manifest
COPY --chown=node:node ./dist \
  /home/node/.n8n/custom/n8n-nodes-db2-sql-builder/dist

COPY --chown=node:node ./package.json \
  /home/node/.n8n/custom/n8n-nodes-db2-sql-builder/package.json

WORKDIR /home/node/.n8n/custom
WORKDIR /home/node/.n8n/custom/n8n-nodes-db2-sql-builder

RUN rm -rf /home/node/.n8n/custom/n8n-nodes-db2-sql-builder/node_modules && \
	pnpm install --prod --prefer-offline 

# 7. Finalize
WORKDIR /home/node
# Set n8n specific port variable
ENV N8N_PORT=8080
# General port variable (helpful for cloud providers)
ENV PORT=8080

# Inform Docker that we are listening on 8080
EXPOSE 8080

ENTRYPOINT ["tini", "--", "n8n"]