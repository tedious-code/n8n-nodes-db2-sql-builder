# Security Policy

## Supported Node.js runtime

This Docker image and package require a **patched** Node.js LTS line (`package.json` → `engines.node`):

```json
"node": "^22.23.4 || ^24.22.1"
```

| Line | Minimum secure version |
|------|------------------------|
| 22.x (Jod LTS) | **22.23.4** |
| 24.x | **24.22.1** |

Do **not** run on Node **22.23.2** (or any earlier 22.x) / unpatched 24.x builds affected by the October 2026 Node.js security releases.

Official advisory: [October 21, 2026 Security Releases](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)

### High-severity issues addressed by upgrading past 22.23.2

| CVE | Severity | Summary |
|-----|----------|---------|
| [CVE-2026-111497](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases) | High | Brotli decoder out-of-bounds write (possible RCE via `node:zlib`) |
| [CVE-2026-105482](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases) | High | DNS `resolve*` NUL truncation (hostname confusion) |
| [CVE-2026-106069](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases) / [CVE-2026-106072](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases) | High | TLS rejects non-canonical IP addresses |

Additional Medium/Low fixes and dependency updates (OpenSSL, c-ares, SQLite, Undici, CA certs) are included in **22.23.4**.

## Docker image pin

The Dockerfile pins:

```text
node:22.23.4-bookworm-slim
```

Floating tags such as `node:22-bookworm-slim` may lag; rebuild and pull this project’s image after each Node security release.

Verify the runtime inside a container:

```bash
docker run --rm --entrypoint node 5nickels/n8n-nodes-db2-sql-builder:latest -v
# expect: v22.23.4 (or newer patched 22.x)
```

## Application / Db2 notes

- Keep **Allow Unsafe SQL** off unless every workflow editor is trusted.
- Use least-privilege Db2 accounts for n8n credentials.
- `ibm_db` is a native addon; only install via this project’s Docker image (not n8n Community Nodes UI).

## Reporting a vulnerability

Open a private security advisory or email the maintainer listed in `package.json`. Please do not file public issues for unpatched RCE-class findings.
