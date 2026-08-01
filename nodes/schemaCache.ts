import {
	ILoadOptionsFunctions,
	INodeListSearchResult,
	INodePropertyOptions,
} from 'n8n-workflow';
import { loadObjectSchemas } from './GenericFunctions';
import { resolveSchema } from './sqlSafety';
import type { FoxTableSchema } from './foxSchema';

interface CacheEntry<T> {
	value: T;
	expiresAt: number;
}

export const columnCache = new Map<string, CacheEntry<INodePropertyOptions[]>>();
export const tableCache = new Map<string, CacheEntry<INodePropertyOptions[]>>();
export const objectCache = new Map<string, CacheEntry<FoxTableSchema[]>>();

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const TABLE_LIKE = new Set(['TABLE', 'VIEW', 'MQT']);

function objectsCacheKey(credentials: Record<string, unknown>): string {
	return [
		'db2',
		resolveSchema(credentials as any),
		String(credentials.host ?? ''),
		String(credentials.database ?? ''),
		String(credentials.username ?? ''),
	].join('|');
}

async function loadCachedObjects(
	this: ILoadOptionsFunctions,
): Promise<FoxTableSchema[]> {
	const credentials = await this.getCredentials('IbmDb2OdbcCredentialsApi');
	const key = objectsCacheKey(credentials as Record<string, unknown>);
	const cached = objectCache.get(key);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.value;
	}

	const objects = await loadObjectSchemas(credentials);
	objectCache.set(key, {
		value: objects,
		expiresAt: Date.now() + CACHE_TTL_MS,
	});
	return objects;
}

function resolveObjectName(param: unknown): string {
	if (typeof param === 'object' && param && 'value' in (param as any)) {
		return String((param as any).value ?? '');
	}
	return String(param ?? '');
}

export async function getColumns(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const tableName = resolveObjectName(this.getNodeParameter('tableId', false));
	if (!tableName) {
		return [];
	}

	const credentials = await this.getCredentials('IbmDb2OdbcCredentialsApi');
	const schema = resolveSchema(credentials);
	const cleanTable = String(tableName).toUpperCase();
	const cacheKey = `${schema}.${cleanTable}`;

	const cached = columnCache.get(cacheKey);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.value;
	}

	let objects: FoxTableSchema[];
	try {
		objects = await loadCachedObjects.call(this);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`FoxSchema column lookup failed: ${message}`);
	}

	const obj = objects.find(
		o =>
			TABLE_LIKE.has(o.objectType) &&
			o.name.toUpperCase() === cleanTable,
	);

	if (!obj) {
		columnCache.set(cacheKey, {
			value: [],
			expiresAt: Date.now() + CACHE_TTL_MS,
		});
		return [];
	}

	const options: INodePropertyOptions[] = (obj.columns ?? [])
		.filter(col => !col.identity)
		.map(col => {
			const nullable = col.nullable === false ? 'NOT NULL' : 'NULL';
			const def = col.defaultValue ? ` ${col.defaultValue}` : ' DEFAULT';
			return {
				name: `${col.name} | ${col.type} | ${nullable}${def}`,
				value: col.name,
			};
		});

	columnCache.set(cacheKey, {
		value: options,
		expiresAt: Date.now() + CACHE_TTL_MS,
	});

	return options;
}

/**
 * Search Tables for Dropdown (via @foxschema/core catalog)
 */
export async function searchTables(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const credentials = await this.getCredentials('IbmDb2OdbcCredentialsApi');
	const schema = resolveSchema(credentials);
	const offset = paginationToken ? parseInt(paginationToken, 10) : 0;
	const search = filter?.trim().toLowerCase() ?? '';
	const cacheKey = `${schema}|${search}`;

	const cached = tableCache.get(cacheKey);
	if (cached && cached.expiresAt > Date.now()) {
		const page = cached.value.slice(offset, offset + 500);
		return {
			results: page,
			paginationToken:
				offset + 500 < cached.value.length ? String(offset + 500) : undefined,
		};
	}

	let objects: FoxTableSchema[];
	try {
		objects = await loadCachedObjects.call(this);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`FoxSchema catalog lookup failed: ${message}`);
	}

	const allResults: INodePropertyOptions[] = objects
		.filter(o => TABLE_LIKE.has(o.objectType))
		.filter(o => !search || o.name.toLowerCase().includes(search))
		.sort((a, b) => a.name.localeCompare(b.name))
		.map(o => ({
			name: o.name,
			value: o.name,
			description: o.objectType,
		}));

	tableCache.set(cacheKey, {
		value: allResults,
		expiresAt: Date.now() + CACHE_TTL_MS,
	});

	const results = allResults.slice(offset, offset + 500);
	return {
		results,
		paginationToken:
			offset + 500 < allResults.length ? String(offset + 500) : undefined,
	};
}
