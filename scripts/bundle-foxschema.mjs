#!/usr/bin/env node
/**
 * Bundle @foxschema/core (sibling monorepo or file dependency) into CJS for n8n.
 * ibm_db stays external — it is compiled and baked into the Docker image.
 */
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist', 'vendor');
const outfile = path.join(outDir, 'foxschema-core.js');

const candidates = [
	path.resolve(root, '../foxSchema/packages/core/src/index.ts'),
	path.resolve(root, 'node_modules/@foxschema/core/src/index.ts'),
];

const entry = candidates.find((p) => fs.existsSync(p));
if (!entry) {
	console.error(
		'Could not find @foxschema/core. Expected sibling ../foxSchema/packages/core or node_modules/@foxschema/core',
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
	],
	logLevel: 'info',
});

console.log(`Bundled foxschema core → ${path.relative(root, outfile)}`);
