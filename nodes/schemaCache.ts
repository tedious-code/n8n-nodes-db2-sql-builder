import {
	ILoadOptionsFunctions,
	INodeListSearchResult,
	INodePropertyOptions,
} from 'n8n-workflow';
import { queryAsync } from './GenericFunctions';
import { resolveSchema } from './sqlSafety';

interface CacheEntry<T> {
	value: T;
	expiresAt: number;
}

export const columnCache = new Map<string, CacheEntry<INodePropertyOptions[]>>();
export const tableCache = new Map<string, CacheEntry<INodePropertyOptions[]>>();

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function getColumns(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const tableParam = this.getNodeParameter('tableId') as any;
	let tableName = '';

	if (typeof tableParam === 'object' && tableParam?.value) {
		tableName = tableParam.value;
	} else if (typeof tableParam === 'string') {
		tableName = tableParam;
	}

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

	const sql = `
		SELECT
			COLNAME,
			TYPENAME,
			LENGTH,
			NULLS,
			DEFAULT
		FROM SYSCAT.COLUMNS
		WHERE TABSCHEMA = ?
		  AND TABNAME   = ?
		  AND IDENTITY  = 'N'
		ORDER BY COLNO
	`;

	const rows = await queryAsync(credentials, sql, [schema, cleanTable]);

	if (!rows.length) {
		columnCache.set(cacheKey, {
			value: [],
			expiresAt: Date.now() + CACHE_TTL_MS,
		});
		return [];
	}

	const options: INodePropertyOptions[] = rows.map(col => {
		const colName = col.COLNAME;
		const typeName = col.TYPENAME;
		const length = col.LENGTH && col.LENGTH > 0 ? `(${col.LENGTH})` : '';
		const nullable = col.NULLS === 'Y' ? 'NULL' : 'NOT NULL';
		const def = col.DEFAULT ? `${col.DEFAULT}` : 'DEFAULT';

		return {
			name: `${colName} | ${typeName}${length} | ${nullable} ${def}`,
			value: colName,
		};
	});

	columnCache.set(cacheKey, {
		value: options,
		expiresAt: Date.now() + CACHE_TTL_MS,
	});

	return options;
}

/**
 * Search Tables for Dropdown
 */
export async function searchTables(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const credentials = await this.getCredentials('IbmDb2OdbcCredentialsApi');
	const schema = resolveSchema(credentials);

	const offset = paginationToken ? parseInt(paginationToken, 10) : 0;
	const search = filter ? `%${filter.toUpperCase()}%` : null;

	const cacheKey = `${schema}|${search ?? ''}`;

	const cached = tableCache.get(cacheKey);
	if (cached && cached.expiresAt > Date.now()) {
		const page = cached.value.slice(offset, offset + 500);

		return {
			results: page,
			paginationToken:
				offset + 500 < cached.value.length ? String(offset + 500) : undefined,
		};
	}

	const sql = `
        SELECT TABLE_NAME AS TABNAME
        FROM SYSIBM.TABLES
		WHERE TABLE_SCHEMA = ?
            ${search ? 'AND UPPER(TABLE_NAME) LIKE ?' : ''}
            AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME ASC WITH UR
	`;

	const params = search ? [schema, search] : [schema];

	let rows: any[];
	try {
		rows = await queryAsync(credentials, sql, params);
	} catch {
		return { results: [] };
	}

	const allResults: INodePropertyOptions[] = rows.map(r => ({
		name: r.TABNAME,
		value: r.TABNAME,
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
