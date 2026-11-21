/**
 * Loads the bundled foxSchema CJS build (@foxschema/db + Db2) produced by scripts/bundle-foxschema.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

export type FoxRoutineParameter = {
	name: string;
	type: string;
	mode: string;
	ordinal?: number;
};

export type FoxColumnInfo = {
	name: string;
	type: string;
	nullable?: boolean;
	defaultValue?: string;
	primaryKey?: boolean;
	identity?: boolean;
};

export type FoxTableSchema = {
	name: string;
	objectType: string;
	columns: FoxColumnInfo[];
	parameters?: FoxRoutineParameter[];
	functionKind?: string;
	definition?: string;
};

type FoxBundle = {
	ConnectionFactory: {
		create: (
			provider: string,
			options: Record<string, unknown>,
			opts?: { pooled?: boolean },
		) => Promise<unknown>;
		close: (provider: string, connection: unknown) => Promise<void>;
		executeQuery: <T = Record<string, unknown>>(
			provider: string,
			options: Record<string, unknown>,
			sql: string,
			params?: readonly unknown[],
		) => Promise<T[]>;
		closeAll: () => Promise<void>;
	};
	getRegisteredProvider: (dialect: string) => {
		testConnection: (options: Record<string, unknown>) => Promise<boolean>;
		getTables?: (
			options: Record<string, unknown>,
			schema: string,
		) => Promise<FoxTableSchema[]>;
	};
	getAdapter: (dialect: string) => {
		query: <T = Record<string, unknown>>(
			connection: unknown,
			sql: string,
			params: readonly unknown[],
		) => Promise<T[]>;
		beginTransaction: (connection: unknown) => Promise<void>;
		commitTransaction: (connection: unknown) => Promise<void>;
		rollbackTransaction: (connection: unknown) => Promise<void>;
		packageName: string;
	};
	/** Present in bundles built by scripts/bundle-foxschema.mjs; absent in older ones. */
	registerDb2?: () => void;
};

function resolveFoxBundlePath(): string {
	const candidates = [
		path.join(__dirname, '..', 'vendor', 'foxschema-core.js'),
		path.join(__dirname, '..', 'dist', 'vendor', 'foxschema-core.js'),
		path.join(process.cwd(), 'dist', 'vendor', 'foxschema-core.js'),
	];
	const found = candidates.find(p => fs.existsSync(p));
	if (!found) {
		throw new Error(
			`foxschema-core bundle not found. Run "pnpm build" first. Tried:\n${candidates.join('\n')}`,
		);
	}
	return found;
}

const nodeRequire = createRequire(__filename);
const fox = nodeRequire(resolveFoxBundlePath()) as FoxBundle;

// Db2 is an add-on (@foxschema/db-db2) in newer foxSchema: register it before
// any getAdapter('db2') / ConnectionFactory use. No-op on older bundles where
// Db2 is built in; idempotent either way.
fox.registerDb2?.();

export const { ConnectionFactory, getRegisteredProvider, getAdapter } = fox;
