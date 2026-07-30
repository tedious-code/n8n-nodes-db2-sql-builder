# syntax=docker/dockerfile:1
# ibm_db needs Debian/glibc. Node 22 bookworm, linux/amd64 (n8n 2.32 requires >=22.22).
# n8n is installed with --ignore-scripts because its bundled isolated-vm
# does not always compile cleanly; Code-node sandbox may be limited —
# sufficient for testing this community node locally.

ARG NODE_VERSION=22-bookworm-slim
ARG N8N_VERSION=2.32.6
ARG LAUNCHER_VERSION=1.1.1

############################
# Stage 1: community node + ibm_db
############################
FROM --platform=linux/amd64 node:${NODE_VERSION} AS extension-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
		python3 \
		make \
		g++ \
		build-essential \
		ca-certificates \
		libaio1 \
		libxml2 \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /build

RUN corepack enable && corepack prepare pnpm@9.1.4 --activate

COPY package.json ./
COPY tsconfig.json gulpfile.js index.ts ./
COPY nodes ./nodes
COPY credentials ./credentials
COPY IbmDb2.svg ./

RUN pnpm install --ignore-scripts \
	&& pnpm rebuild ibm_db \
	&& pnpm build \
	&& rm -rf node_modules \
	&& pnpm install --prod --ignore-scripts=false \
	&& pnpm store prune

############################
# Stage 2: runtime
############################
FROM --platform=linux/amd64 node:${NODE_VERSION} AS runtime

ARG N8N_VERSION
ARG LAUNCHER_VERSION

ENV NODE_ENV=production \
	N8N_RELEASE_TYPE=stable \
	N8N_VERSION=${N8N_VERSION} \
	N8N_PORT=5678 \
	PORT=5678 \
	N8N_CUSTOM_EXTENSIONS=/opt/n8n-custom

RUN apt-get update && apt-get install -y --no-install-recommends \
		tini \
		ca-certificates \
		openssl \
		wget \
		python3 \
		make \
		g++ \
		build-essential \
		libaio1 \
		libxml2 \
	&& rm -rf /var/lib/apt/lists/*

# Install n8n without compiling broken optional natives; then rebuild sqlite only if present
RUN npm install -g n8n@${N8N_VERSION} --ignore-scripts \
	&& (npm rebuild -g sqlite3 better-sqlite3 2>/dev/null || true) \
	&& npm cache clean --force \
	&& rm -rf /root/.npm \
	&& n8n --version

# Drop compilers from the final image layer after n8n install
USER root
RUN apt-get purge -y python3 make g++ build-essential \
	&& apt-get autoremove -y \
	&& rm -rf /var/lib/apt/lists/*

COPY n8n-task-runners.json /etc/n8n-task-runners.json
RUN set -eux; \
	mkdir /launcher-temp; \
	cd /launcher-temp; \
	wget -q "https://github.com/n8n-io/task-runner-launcher/releases/download/${LAUNCHER_VERSION}/task-runner-launcher-${LAUNCHER_VERSION}-linux-amd64.tar.gz"; \
	wget -q "https://github.com/n8n-io/task-runner-launcher/releases/download/${LAUNCHER_VERSION}/task-runner-launcher-${LAUNCHER_VERSION}-linux-amd64.tar.gz.sha256"; \
	echo "$(cat task-runner-launcher-${LAUNCHER_VERSION}-linux-amd64.tar.gz.sha256)  task-runner-launcher-${LAUNCHER_VERSION}-linux-amd64.tar.gz" > checksum.sha256; \
	sha256sum -c checksum.sha256; \
	tar xf "task-runner-launcher-${LAUNCHER_VERSION}-linux-amd64.tar.gz" -C /usr/local/bin; \
	cd /; \
	rm -rf /launcher-temp

RUN mkdir -p /opt/n8n-custom/node_modules/n8n-nodes-db2-sql-builder \
	&& chown -R node:node /opt/n8n-custom /home/node

COPY --from=extension-builder --chown=node:node /build/dist \
	/opt/n8n-custom/node_modules/n8n-nodes-db2-sql-builder/dist
COPY --from=extension-builder --chown=node:node /build/package.json \
	/opt/n8n-custom/node_modules/n8n-nodes-db2-sql-builder/package.json
COPY --from=extension-builder --chown=node:node /build/node_modules \
	/opt/n8n-custom/node_modules/n8n-nodes-db2-sql-builder/node_modules
# Also keep a top-level package path for CustomDirectoryLoader globs
RUN ln -sfn /opt/n8n-custom/node_modules/n8n-nodes-db2-sql-builder \
	/opt/n8n-custom/n8n-nodes-db2-sql-builder

COPY --chown=root:root docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh \
	&& mkdir -p /home/node/.n8n \
	&& chown -R node:node /home/node

USER node
WORKDIR /home/node

EXPOSE 5678

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
	CMD wget -qO- http://127.0.0.1:5678/healthz || exit 1

ENTRYPOINT ["tini", "--", "/docker-entrypoint.sh"]
