import {
	ILoadOptionsFunctions,
	INodeListSearchResult,
	INodePropertyOptions,
} from 'n8n-workflow';
import { loadObjectSchemas } from './GenericFunctions';
import { findRoutine } from './routineCall';
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
const ROUTINE_TYPES = new Set(['PROCEDURE', 'FUNCTION']);

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

function objectLabel(obj: FoxTableSchema): string {
	const type = obj.objectType || 'TABLE';
	if (ROUTINE_TYPES.has(type)) {
		const kind = obj.functionKind ? `/${obj.functionKind}` : '';
		return `[${type}${kind}] ${obj.name}`;
	}
	return `[${type}] ${obj.name}`;
}

function filterObjects(
	objects: FoxTableSchema[],
	filter: string | undefined,
	types: Set<string>,
): INodePropertyOptions[] {
	const search = filter?.trim().toLowerCase();
	return objects
		.filter(o => types.has(o.objectType))
		.filter(o => !search || o.name.toLowerCase().includes(search))
		.sort((a, b) => a.name.localeCompare(b.name))
		.map(o => ({
			name: objectLabel(o),
			value: o.name,
			description: o.objectType,
		}));
}

async function searchByTypes(
	this: ILoadOptionsFunctions,
	types: Set<string>,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const offset = paginationToken ? parseInt(paginationToken, 10) : 0;
	let objects: FoxTableSchema[];
	try {
		objects = await loadCachedObjects.call(this);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`FoxSchema catalog lookup failed: ${message}`);
	}

	const allResults = filterObjects(objects, filter, types);
	const results = allResults.slice(offset, offset + 500);
	return {
		results,
		paginationToken:
			offset + 500 < allResults.length ? String(offset + 500) : undefined,
	};
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

/** Tables + views for row operations */
export async function searchTables(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	return searchByTypes.call(this, TABLE_LIKE, filter, paginationToken);
}

/** Procedures + functions */
export async function searchRoutines(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	return searchByTypes.call(this, ROUTINE_TYPES, filter, paginationToken);
}

/** Procedures only */
export async function searchProcedures(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	return searchByTypes.call(this, new Set(['PROCEDURE']), filter, paginationToken);
}

/** Functions only */
export async function searchFunctions(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	return searchByTypes.call(this, new Set(['FUNCTION']), filter, paginationToken);
}

/** All supported object types */
export async function searchDbObjects(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	return searchByTypes.call(
		this,
		new Set(['TABLE', 'VIEW', 'MQT', 'PROCEDURE', 'FUNCTION']),
		filter,
		paginationToken,
	);
}

export async function getParameters(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const routineName = resolveObjectName(
		this.getNodeParameter('routineId', false),
	);
	if (!routineName) return [];

	const operation = String(
		this.getNodeParameter('routineOperation', false) ?? '',
	);
	const expectedType: 'PROCEDURE' | 'FUNCTION' | undefined =
		operation === 'callProcedure'
			? 'PROCEDURE'
			: operation === 'callFunction'
				? 'FUNCTION'
				: undefined;

	let objects: FoxTableSchema[];
	try {
		objects = await loadCachedObjects.call(this);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`FoxSchema parameter lookup failed: ${message}`);
	}

	let obj: FoxTableSchema;
	try {
		obj = findRoutine(objects, routineName, expectedType);
	} catch {
		return [];
	}

	return (obj.parameters ?? [])
		.slice()
		.sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0))
		.filter(p => {
			const mode = String(p.mode ?? 'IN').toUpperCase();
			return mode === 'IN' || mode === 'INOUT';
		})
		.filter(p => Boolean(String(p.name ?? '').trim()))
		.map(p => ({
			name: `${p.mode || 'IN'} ${p.name} | ${p.type}`,
			value: p.name,
			description: `${p.mode || 'IN'} ${p.type}`,
		}));
}
