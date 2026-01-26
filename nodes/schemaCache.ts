import * as ibm_db from 'ibm_db';
import { ILoadOptionsFunctions, INodeListSearchResult, INodePropertyOptions } from 'n8n-workflow/dist/esm/interfaces';
import { getConnectionString } from './GenericFunctions';

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

	/* -------------------------------
	   GET TABLE PARAM (SAFE)
	-------------------------------- */
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

	/* -------------------------------
	   GET CREDENTIALS
	-------------------------------- */
	const credentials = await this.getCredentials(
		'IbmDb2OdbcCredentialsApi',
	);
	const connStr = getConnectionString(credentials);

	const schema =
		((credentials.schema as string) || 'DB2INST1').toUpperCase();

	const cleanTable = tableName.toUpperCase();
	const cacheKey = `${schema}.${cleanTable}`;

	/* -------------------------------
	   MANUAL REFRESH (OPTIONAL)
	   (add boolean param in node UI)
	-------------------------------- */
	const refresh = this.getNodeParameter(
		'refreshColumns',
		0,		
	) as boolean ?? false;

	if (refresh) {
		columnCache.delete(cacheKey);
	}

	/* -------------------------------
	   CACHE HIT (TTL CHECK)
	-------------------------------- */
	const cached = columnCache.get(cacheKey);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.value;
	}

	/* -------------------------------
	   SQL (SAFE – PARAM BINDING)
	-------------------------------- */
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

	/* -------------------------------
	   QUERY DB
	-------------------------------- */
	const rows: any[] = await new Promise((resolve, reject) => {
		ibm_db.open(connStr, (err, conn) => {
			if (err) return reject(err);

			conn.query(sql, [schema, cleanTable], (e, result) => {
				conn.close(() => {});
				if (e) return reject(e);
				resolve(result ?? []);
			});
		});
	});

	if (!rows.length) {
		columnCache.set(cacheKey, {
			value: [],
			expiresAt: Date.now() + CACHE_TTL_MS,
		});
		return [];
	}

	/* -------------------------------
	   FORMAT OPTIONS (UI vs SQL)
	-------------------------------- */
	const options: INodePropertyOptions[]  = [];//[{ name: 'All Columns (*)', value: '*' }];

	options.push(...rows.map(col => {
		const colName = col.COLNAME;
		const typeName = col.TYPENAME;
		const length =
			col.LENGTH && col.LENGTH > 0 ? `(${col.LENGTH})` : '';
		const nullable = col.NULLS === 'Y' ? 'NULL' : 'NOT NULL';
		const def = col.DEFAULT ? `${col.DEFAULT}` : 'DEFAULT';

		return {
			name: `${colName} | ${typeName}${length} | ${nullable} ${def}`,
			value: colName,
		};
	}));
	/* -------------------------------
	   SAVE CACHE
	-------------------------------- */
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

	/* -------------------------------
	   CREDENTIALS / SCHEMA
	-------------------------------- */
	const credentials = await this.getCredentials(
		'IbmDb2OdbcCredentialsApi',
	);

	const schema =
		((credentials.schema as string) || 'DB2INST1').toUpperCase();

	const connStr = getConnectionString(credentials);

	/* -------------------------------
	   PAGINATION
	-------------------------------- */
	const offset = paginationToken ? parseInt(paginationToken, 10) : 0;
	const search = filter ? `%${filter.toUpperCase()}%` : null;

	/* -------------------------------
	   CACHE KEY
	-------------------------------- */
	const cacheKey = `${schema}|${search ?? ''}`;

	const cached = tableCache.get(cacheKey);
	if (cached && cached.expiresAt > Date.now()) {
		const page = cached.value.slice(offset, offset + 500);

		return {
			results: page,
			paginationToken:
				offset + 500 < cached.value.length
					? String(offset + 500)
					: undefined,
		};
	}
	console.log('Search:', search);
	/* -------------------------------
	   SQL (SAFE)
	-------------------------------- */
	const sql = `
        SELECT TABLE_NAME AS TABNAME
        FROM SYSIBM.TABLES
        WHERE TABLE_SCHEMA = '${schema}'
            ${search ? `AND LOWER(TABLE_NAME) LIKE '${search.toLowerCase()}%'` : ''}
            AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME ASC WITH UR;
	`;

	const params = search ? [schema, search] : [schema];

	/* -------------------------------
	   QUERY
	-------------------------------- */
	const rows: any[] = await new Promise((resolve) => {
		ibm_db.open(connStr, (err, conn) => {
			if (err) {
				console.error('[DB2] open error', err);
				return resolve([]);
			}

			conn.query(sql, params, (e, result) => {
				conn.close(() => {});
				if (e) {
					console.error('[DB2] query error', e);
					return resolve([]);
				}
				resolve(result ?? []);
			});
		});
	});

	/* -------------------------------
	   FORMAT OPTIONS
	-------------------------------- */
	const allResults: INodePropertyOptions[] = rows.map(r => ({
		name: r.TABNAME,
		value: r.TABNAME,
	}));

	/* -------------------------------
	   SAVE CACHE
	-------------------------------- */
	tableCache.set(cacheKey, {
		value: allResults,
		expiresAt: Date.now() + CACHE_TTL_MS,
	});

	/* -------------------------------
	   PAGINATE RESULT
	-------------------------------- */
	const results = allResults.slice(offset, offset + 500);

	return {
		results,
		paginationToken:
			offset + 500 < allResults.length
				? String(offset + 500)
				: undefined,
	};
}
