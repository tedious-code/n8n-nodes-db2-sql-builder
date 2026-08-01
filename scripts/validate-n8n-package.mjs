#!/usr/bin/env node
/**
 * Validate this package can be discovered/loaded by n8n as a community node.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const pkg = require(path.join(root, 'package.json'));

const failures = [];
const ok = (cond, msg) => {
	if (!cond) failures.push(msg);
	else console.log(`OK  ${msg}`);
};

ok(typeof pkg.name === 'string' && /^(?:@[^/]+\/)?n8n-nodes-/.test(pkg.name), 'package name is n8n-nodes-*');
ok(Array.isArray(pkg.keywords) && pkg.keywords.includes('n8n-community-node-package'), 'has n8n-community-node-package keyword');
ok(pkg.n8n && typeof pkg.n8n === 'object', 'has n8n object');
ok(Number.isInteger(pkg.n8n?.n8nNodesApiVersion) && pkg.n8n.n8nNodesApiVersion > 0, 'n8nNodesApiVersion is positive integer');
ok(Array.isArray(pkg.n8n?.nodes) && pkg.n8n.nodes.length > 0, 'n8n.nodes is non-empty array');
ok(Array.isArray(pkg.n8n?.credentials), 'n8n.credentials is an array');

for (const p of pkg.n8n?.nodes ?? []) {
	ok(typeof p === 'string' && p.startsWith('dist/'), `node path starts with dist/: ${p}`);
	ok(fs.existsSync(path.join(root, p)), `node file exists: ${p}`);
	ok(p.endsWith('.node.js'), `node path ends with .node.js: ${p}`);
	const jsonPath = p.replace(/\.js$/, '.json');
	ok(fs.existsSync(path.join(root, jsonPath)), `codex json exists: ${jsonPath}`);
	const base = path.dirname(path.join(root, p));
	const js = fs.readFileSync(path.join(root, p), 'utf8');
	const iconMatch = js.match(/icon:\s*['"]file:([^'"]+)['"]/);
	if (iconMatch) {
		ok(fs.existsSync(path.join(base, iconMatch[1])), `icon exists next to node: ${iconMatch[1]}`);
	}
	// Load compiled node module
	try {
		const mod = require(path.join(root, p));
		const exported = mod.Db2SQLBuilder || Object.values(mod).find((v) => typeof v === 'function');
		ok(typeof exported === 'function', `exports a node class from ${p}`);
		if (typeof exported === 'function') {
			const instance = new exported();
			ok(!!instance.description?.name, 'node description.name present');
			ok(!!instance.description?.displayName, 'node description.displayName present');
			ok(typeof instance.execute === 'function' || typeof instance.poll === 'function' || typeof instance.trigger === 'function', 'node has execute/poll/trigger');
		}
	} catch (e) {
		failures.push(`failed to require ${p}: ${(e).message}`);
	}
}

for (const p of pkg.n8n?.credentials ?? []) {
	ok(typeof p === 'string' && p.startsWith('dist/'), `credential path starts with dist/: ${p}`);
	ok(fs.existsSync(path.join(root, p)), `credential file exists: ${p}`);
	try {
		const mod = require(path.join(root, p));
		const Cred = mod.IbmDb2OdbcCredentialsApi || Object.values(mod).find((v) => typeof v === 'function');
		ok(typeof Cred === 'function', `exports a credential class from ${p}`);
		if (typeof Cred === 'function') {
			const c = new Cred();
			ok(!!c.name && !!c.properties, 'credential has name + properties');
		}
	} catch (e) {
		failures.push(`failed to require ${p}: ${(e).message}`);
	}
}

ok(Array.isArray(pkg.files) && pkg.files.includes('dist'), 'files includes dist');
ok(fs.existsSync(path.join(root, 'dist', 'vendor', 'foxschema-core.js')), 'foxschema-core bundle present under dist/vendor');

console.log('\nNote: ibm_db runtime dep → Docker/custom only; not n8n verified-community eligible.');

if (failures.length) {
	console.error('\nFAIL');
	for (const f of failures) console.error(` - ${f}`);
	process.exit(1);
}

console.log('\nPackage format looks installable into n8n.');
