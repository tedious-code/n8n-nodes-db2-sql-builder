![Banner image](https://user-images.githubusercontent.com/10284570/173569848-c624317f-42b1-45a6-ab09-f0ea3c247648.png)

# 🧱 n8n-nodes-db2-sql-builder

A powerful **IBM Db2 SQL Builder** community node for **n8n**, designed for advanced SQL execution, dynamic parameter binding, and workflow-safe query orchestration.

---
## ⚠️ IBM DB2 Node Compatibility Note

The IBM DB2 community node (using ibm_db) only works reliably on Debian-based environments with Node.js 20.
ibm_db is a native Node.js addon and depends on:
-- Node.js ABI version
-- node-gyp toolchain
-- System libraries (DB2 CLI, unixODBC, libaio, libxml2)

* n8n hosting / n8n Cloud / installing the package directly via the n8n UI:
❌ Cannot compile native modules
❌ Missing required DB2 system libraries
❌ Results in odbc_bindings.node or NODE_MODULE_VERSION errors

* ✅ Required Setup
To use this node, you must build a custom Docker image:
Base image: node:20-bookworm-slim
Build ibm_db from source
Bake the community node into the image
This approach ensures the IBM DB2 node works correctly and consistently in n8n.

## ✨ Features

### ✅ SQL Execution
- Execute **multiple SQL queries** in sequence
- Optional **transaction support** (BEGIN / COMMIT / ROLLBACK)
- **Stop on error** or continue execution

### 🔗 Parameter Binding
- Positional parameters `?`
- **Named parameters** `:id`, `:userId`
- Supports:
  - String
  - Number
  - Boolean
  - Date
  - Null
- Dynamic bindings from previous outputs:
  ```sql
  WHERE id IN (${output0.COL1})
  WHERE id IN ([${output0.COL1}, 6, 1])
  ```

### 📦 Smart IN / BETWEEN Handling
- Auto-expand `IN (?)` for arrays
- Supports:
  ```sql
  col IN (?, ?, ?)
  col BETWEEN ? AND ?
  ```
- Empty array → auto short-circuit (returns empty result safely)

### 🔍 Preview / Dry Run Mode
- Validate SQL without execution
- Shows:
  - Final SQL
  - Placeholder count
  - Bound parameters

### 🔄 Result Transform
- Optional **JavaScript transform**
- Access:
  - `result`
  - `context.output0`, `context.output1`, ...
- Async supported

### 📤 Output Modes
- All outputs
- Merge outputs
- Last output only
- Specific output index

---

## 🧱 Node UI Overview

### Global Options
- Use Transaction
- Stop On Error
- Preview Query
- Output Mode

### Per Query
- SQL Editor (Standard SQL)
- Parameters (auto-hinted Parameter #1, #2…)
- Transform Result (JS Editor)

---

## 📌 Example

```sql
SELECT *
FROM users
WHERE id IN (?)
AND created_at BETWEEN ? AND ?
```

Bindings:
```json
[
  { "type": "number", "value": "[1,2,3]" },
  { "type": "date", "value": "2024-01-01" },
  { "type": "date", "value": "2024-12-31" }
]
```

---

## 🚀 Installation

### From pnpm (recommended)
```bash
pnpm install n8n-nodes-db2-sql-builder
```

### Manual (local development)
```bash
git clone https://github.com/tedious-code/n8n-nodes-db2-sql-builder.git
cd n8n-nodes-db2-sql-builder
pnpm install
pnpm run build
```

---

## 🐳 Docker + n8n

```bash
docker compose -f docker-compose.yml up -d --build
```

---

## 🧪 Development

```bash
pnpm run build
```

Clear Docker cache if UI not updating:
```bash
docker compose down -v
docker build -t n8n-nodes-db2-sql-builder .
```
Docker run
```bash
docker run -it --rm \                      
  --name n8n-node-db2-sql-builder \
  -p 5678:5678 \
  -e DB_TYPE=postgresdb \
  -e DB_POSTGRESDB_DATABASE= [TYPE DATABASE] \
  -e DB_POSTGRESDB_HOST= [Server host] \
  -e DB_POSTGRESDB_PORT=5432 \
  -e DB_POSTGRESDB_USER= [User ] \
  -e DB_POSTGRESDB_SCHEMA=public \
  -e DB_POSTGRESDB_PASSWORD= ******* \
  -e DB_POSTGRESDB_SSL=true \
  -e DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED=false \
  -e N8N_COMMUNITY_PACKAGES_ENABLED=true \
  n8n-nodes-db2-sql-builder
```
---

## ⚠️ Notes
- Empty array bindings return empty output safely
- Preview mode disables transactions automatically

---

## 📜 License
[MIT](https://github.com/n8n-io/n8n-nodes-starter/blob/master/LICENSE.md)

---

## 🤝 Contributing

Pull requests welcome!
If you find a bug or want a feature, open an issue.

---

## Postgres DB serverless 
https://neon.com/

## ⭐ Credits

Built with ❤️ for the **n8n Community**

## More information

Refer to our [documentation on creating nodes](https://docs.n8n.io/integrations/creating-nodes/) for detailed information on building your own nodes.

