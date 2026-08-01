![Banner image](https://user-images.githubusercontent.com/10284570/173569848-c624317f-42b1-45a6-ab09-f0ea3c247648.png)

# n8n-nodes-db2-sql-builder

IBM **Db2** SQL Builder for [n8n](https://n8n.io), powered by [`@foxschema/core`](https://foxschema.com) (Db2 provider + `ibm_db` adapter).

**Package name stays `n8n-nodes-db2-sql-builder`.** Distribution is **Docker Hub only**.

---

## Distribution (important)

| Channel | Supported? |
|---|---|
| **Docker Hub** (`5nickels/n8n-nodes-db2-sql-builder`) | Yes |
| npm / n8n **Community nodes** UI install | **No** |

`ibm_db` is a native addon (CLI driver + compile toolchain). n8n cannot preinstall that via the community-node installer, so this package is **not** meant for npmjs / verified-community install.

For multi-dialect SQL builder **without** Db2 (Postgres, MySQL, MariaDB, SQL Server, Oracle) via npm, use [`n8n-nodes-fox-schema-sql-builder`](https://www.npmjs.com/package/n8n-nodes-fox-schema-sql-builder).

---

## Docker Hub

```bash
docker pull 5nickels/n8n-nodes-db2-sql-builder:0.1.1
# or
docker pull 5nickels/n8n-nodes-db2-sql-builder:latest
```

Local compose (requires sibling [`foxSchema`](https://github.com/tedious-code/foxschema) checkout next to this repo for image builds):

```bash
# Layout:
#   ../foxSchema/
#   ./n8n-nodes-db2-sql-builder/   (this repo)

cp .env.example .env
docker compose up -d --build
# UI: http://localhost:5678
```

Compose builds with `context: ..` so the Dockerfile can bundle `@foxschema/core` from `../foxSchema/packages/core`.

---

## Features

- Row get / create / update / delete with SELECT, WHERE, GROUP BY, HAVING, ORDER BY, `FETCH FIRST`
- Execute Query: multi-statement, bindings, preview/dry-run, transactions
- Catalog browse via foxSchema Db2 provider (`getTables`)
- Security: **Allow Unsafe SQL** off by default; validated identifiers; schema-qualified tables

---

## Credentials

**IBM DB2 Credential** — host, database, user, password, port (default 50000), protocol / SSL, schema (default `DB2INST1`). Mapped to foxSchema `ConnectionOptions` for the Db2 adapter.

---

## Development

Requires sibling `../foxSchema` for `pnpm build` (bundles core into `dist/vendor/foxschema-core.js`).

```bash
pnpm install
pnpm test
pnpm build
pnpm validate:n8n
```

`validate:n8n` checks package layout for custom Docker installs — it does **not** mean the package is eligible as a verified community node (runtime `ibm_db` remains).

---

## Security notes

- Raw SQL expressions, EXISTS subqueries, and SQL-typed bind parameters require **Allow Unsafe SQL**.
- Prefer least-privilege Db2 accounts for n8n workflows.

## License

[MIT](./LICENSE.md)
