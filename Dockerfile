# syntax=docker/dockerfile:1
#
# Slim multi-stage image for self-hosted n8n + Db2 community node.
# ibm_db requires glibc → Debian bookworm (not Alpine).
# Final stage never installs compilers (avoids ~400MB leftover apt layers).

ARG NODE_VERSION=22-bookworm-slim
ARG N8N_VERSION=2.32.6

############################
# 1) Build community node + compile ibm_db
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

# Skip unrelated native addons from n8n-workflow; rebuild ibm_db only
RUN pnpm install --ignore-scripts \
	&& pnpm rebuild ibm_db \
	&& pnpm build \
	&& rm -rf node_modules \
	&& pnpm install --prod --ignore-scripts=false \
	&& pnpm store prune \
	&& find node_modules -type f \( -name '*.md' -o -name '*.ts' -o -name '*.map' -o -name 'LICENSE*' \) -delete \
	&& find node_modules -type d \( -name test -o -name tests -o -name __tests__ -o -name docs -o -name example -o -name examples \) -prune -exec rm -rf {} +

############################
# 2) Install n8n (discarded except for copied artifacts)
############################
FROM --platform=linux/amd64 node:${NODE_VERSION} AS n8n-builder

ARG N8N_VERSION

# Compilers only exist in this throwaway stage
RUN apt-get update && apt-get install -y --no-install-recommends \
		python3 \
		make \
		g++ \
		build-essential \
		ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

# ignore-scripts: skip natives that often fail (e.g. isolated-vm).
# TypeORM needs sqlite3's native binding — rebuild it while compilers exist.
RUN npm install -g "n8n@${N8N_VERSION}" --omit=dev --ignore-scripts \
	&& npm cache clean --force \
	&& cd /usr/local/lib/node_modules/n8n \
	&& npm rebuild sqlite3 \
	&& node -e "require('sqlite3'); console.log('sqlite3 native ok')" \
	&& cd / \
	&& rm -rf /root/.npm /tmp/* \
	&& n8n --version \
	&& find /usr/local/lib/node_modules/n8n -type f \( -name '*.map' -o -name '.DS_Store' \) -delete

############################
# 3) Slim runtime — no compilers
############################
FROM --platform=linux/amd64 node:${NODE_VERSION} AS runtime

ARG N8N_VERSION

ENV NODE_ENV=production \
	N8N_RELEASE_TYPE=stable \
	N8N_VERSION=${N8N_VERSION} \
	N8N_PORT=5678 \
	PORT=5678 \
	N8N_CUSTOM_EXTENSIONS=/opt/n8n-custom

# Runtime libs only
RUN apt-get update && apt-get install -y --no-install-recommends \
		tini \
		ca-certificates \
		openssl \
		wget \
		libaio1 \
		libxml2 \
	&& rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# n8n from builder (no apt build tools in this layer history)
COPY --from=n8n-builder /usr/local/lib/node_modules/n8n /usr/local/lib/node_modules/n8n
RUN ln -sfn /usr/local/lib/node_modules/n8n/bin/n8n /usr/local/bin/n8n \
	&& n8n --version

# Community node (npm-style path for PackageDirectoryLoader + symlink for CustomDirectoryLoader)
RUN mkdir -p /opt/n8n-custom/node_modules \
	&& chown -R node:node /opt/n8n-custom /home/node

COPY --from=extension-builder --chown=node:node /build/dist \
	/opt/n8n-custom/node_modules/n8n-nodes-db2-sql-builder/dist
COPY --from=extension-builder --chown=node:node /build/package.json \
	/opt/n8n-custom/node_modules/n8n-nodes-db2-sql-builder/package.json
COPY --from=extension-builder --chown=node:node /build/node_modules \
	/opt/n8n-custom/node_modules/n8n-nodes-db2-sql-builder/node_modules

RUN ln -sfn /opt/n8n-custom/node_modules/n8n-nodes-db2-sql-builder \
		/opt/n8n-custom/n8n-nodes-db2-sql-builder \
	&& mkdir -p /home/node/.n8n \
	&& chown -R node:node /home/node /opt/n8n-custom

COPY --chown=root:root docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

USER node
WORKDIR /home/node

EXPOSE 5678

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
	CMD wget -qO- http://127.0.0.1:5678/healthz || exit 1

ENTRYPOINT ["tini", "--", "/docker-entrypoint.sh"]
