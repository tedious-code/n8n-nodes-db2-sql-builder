#!/usr/bin/env node
/**
 * Bundle @foxschema/db (+ reachable @foxschema/sql) into CJS for n8n.
 * ibm_db stays external — compiled and baked into the Docker image.
 */
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist', 'vendor');
const outfile = path.join(outDir, 'foxschema-core.js');
const entry = path.join(root, 'scripts', 'foxschema-bundle-entry.ts');

const foxRootCandidates = [
	process.env.FOX_SCHEMA_ROOT,
	path.resolve(root, 'foxSchema'),
	path.resolve(root, '../foxSchema'),
	path.resolve(root, '../foxschema'),
].filter(Boolean);
const foxRoot = foxRootCandidates.find((p) =>
	fs.existsSync(path.join(p, 'packages/db/src/cores/connection-factory.ts')),
);

const nodeDb = path.resolve(root, 'node_modules/@foxschema/db');
const nodeSql = path.resolve(root, 'node_modules/@foxschema/sql');

const factory = foxRoot
	? path.join(foxRoot, 'packages/db/src/cores/connection-factory.ts')
	: path.join(nodeDb, 'src/cores/connection-factory.ts');
const adapters = foxRoot
	? path.join(foxRoot, 'packages/db/src/providers/adapter-registry.ts')
	: path.join(nodeDb, 'src/providers/adapter-registry.ts');
const providers = foxRoot
	? path.join(foxRoot, 'packages/db/src/providers/provider-registry.ts')
	: path.join(nodeDb, 'src/providers/provider-registry.ts');
const sqlEntry = foxRoot
	? path.join(foxRoot, 'packages/sql/src/index.ts')
	: path.join(nodeSql, 'src/index.ts');

if (!fs.existsSync(factory) || !fs.existsSync(sqlEntry) || !fs.existsSync(entry)) {
	console.error(
		'Could not find @foxschema/db + @foxschema/sql. Expected sibling ../foxSchema/packages/{db,sql} or node_modules/@foxschema/{db,sql}',
	);
	process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

await esbuild.build({
	entryPoints: [entry],
	bundle: true,
	platform: 'node',
	format: 'cjs',
	target: 'node20',
	outfile,
	sourcemap: true,
	banner: {
		js: 'var __fox_import_meta_url = require("url").pathToFileURL(__filename).href;',
	},
	define: {
		'import.meta.url': '__fox_import_meta_url',
	},
	alias: {
		'@foxschema/sql': sqlEntry,
		'@foxschema/db': foxRoot
			? path.join(foxRoot, 'packages/db/src/index.ts')
			: path.join(nodeDb, 'src/index.ts'),
		'#foxschema-factory': factory,
		'#foxschema-adapters': adapters,
		'#foxschema-providers': providers,
	},
	external: [
		'pg',
		'mysql2',
		'mysql2/promise',
		'mssql',
		'oracledb',
		'ibm_db',
		'better-sqlite3',
		'@clickhouse/client',
		'@duckdb/node-api',
		'mongodb',
		'redis',
	],
	logLevel: 'info',
});

console.log(`Bundled foxschema db → ${path.relative(root, outfile)}`);
