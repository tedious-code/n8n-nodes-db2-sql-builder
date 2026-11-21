#!/usr/bin/env node
/**
 * Bundle @foxschema/db (+ the @foxschema/sql it reaches) and, when present,
 * the @foxschema/db-db2 add-on into one CJS file for n8n.
 *
 * foxSchema source comes from FOX_SCHEMA_ROOT, a sibling ../foxSchema checkout,
 * or node_modules/@foxschema/{db,sql,db-db2}.
 *
 * Two foxSchema layouts are supported:
 * - Db2 built into @foxschema/db (packages/db/src/providers/db2): no add-on.
 * - Db2 split out into @foxschema/db-db2 (packages/db-db2): the add-on is
 *   bundled and the node calls its registerDb2() at load.
 *
 * ibm_db stays external: it is compiled and baked into the Docker image.
 */
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist', 'vendor');
const outfile = path.join(outDir, 'foxschema-core.js');
const entry = path.join(__dirname, 'foxschema-bundle-entry.ts');
const db2Stub = path.join(__dirname, 'foxschema-db2-stub.ts');

const foxRootCandidates = [
	process.env.FOX_SCHEMA_ROOT,
	path.resolve(root, 'foxSchema'),
	path.resolve(root, '../foxSchema'),
	path.resolve(root, '../foxschema'),
].filter(Boolean);
const foxRoot = foxRootCandidates.find((p) =>
	fs.existsSync(path.join(p, 'packages/db/src/cores/connection-factory.ts')),
);

/** Source dir of a foxSchema package, from the monorepo or node_modules. */
const pkgSrc = (dir, name) =>
	foxRoot
		? path.join(foxRoot, 'packages', dir, 'src')
		: path.join(root, 'node_modules', '@foxschema', name, 'src');

const dbSrc = pkgSrc('db', 'db');
const sqlSrc = pkgSrc('sql', 'sql');
const db2Src = pkgSrc('db-db2', 'db-db2');

const factory = path.join(dbSrc, 'cores/connection-factory.ts');
const adapters = path.join(dbSrc, 'providers/adapter-registry.ts');
const providers = path.join(dbSrc, 'providers/provider-registry.ts');
const sqlEntry = path.join(sqlSrc, 'index.ts');
const db2Entry = path.join(db2Src, 'index.ts');
const hasDb2Addon = fs.existsSync(db2Entry);

if (![factory, adapters, providers, sqlEntry].every((p) => fs.existsSync(p))) {
	console.error(
		'Could not find @foxschema/db + @foxschema/sql. Set FOX_SCHEMA_ROOT, or expected sibling ../foxSchema/packages/{db,sql} or node_modules/@foxschema/{db,sql}',
	);
	process.exit(1);
}
if (!hasDb2Addon && !fs.existsSync(path.join(dbSrc, 'providers/db2'))) {
	console.error(
		`Db2 not found: neither ${path.relative(root, db2Entry)} (@foxschema/db-db2) nor @foxschema/db's built-in providers/db2 exists.`,
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
		'@foxschema/db': path.join(dbSrc, 'index.ts'),
		// @foxschema/db can lazy-load the add-on by name; keep that inside the bundle.
		...(hasDb2Addon ? { '@foxschema/db-db2': db2Entry } : {}),
		'#foxschema-factory': factory,
		'#foxschema-adapters': adapters,
		'#foxschema-providers': providers,
		'#foxschema-db2': hasDb2Addon ? db2Entry : db2Stub,
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
		...(hasDb2Addon ? [] : ['@foxschema/db-db2']),
	],
	logLevel: 'info',
});

console.log(
	`Bundled foxschema db${hasDb2Addon ? ' + db-db2' : ' (built-in Db2)'} from ${foxRoot ?? 'node_modules'} → ${path.relative(root, outfile)}`,
);
