import * as ibm_db from 'ibm_db';
import {
	type IDataObject,
	type ICredentialDataDecryptedObject,
	type INodeExecutionData,
	type IExecuteFunctions,
	NodeOperationError,
} from 'n8n-workflow';
import { ColumnSchema, SelectItem, WhereGroup } from './type';
import {
	buildGroupBy,
	buildHaving,
	buildLimit,
	buildOrderBy,
	buildSchemaMap,
	buildSelectClause,
	buildWhereClause,
	normalizeUiWhere,
} from './builder';
import {
	assertIdent,
	assertSafeSqlFragment,
	assertSafeWhereGroups,
	buildConnectionString,
	normalizeSafeInsertLiteral,
	poolCacheKey,
	qualifyTable,
	quoteIdent,
	resolveSchema,
} from './sqlSafety';

/* ---------------------------------- */
/* Connection */
/* ---------------------------------- */

const DB2_POOL_MAX_SIZE = 10;
const DB2_POOL_IDLE_TIMEOUT_MS = 60_000;

type PoolEntry = {
	pool: ibm_db.Pool;
	connectionString: string;
};

const db2Pools = new Map<string, PoolEntry>();

function getDb2Pool(credentials: ICredentialDataDecryptedObject): PoolEntry {
	const key = poolCacheKey(credentials);
	let entry = db2Pools.get(key);
	if (!entry) {
		entry = {
			pool: new ibm_db.Pool({
				maxPoolSize: DB2_POOL_MAX_SIZE,
				idleTimeout: DB2_POOL_IDLE_TIMEOUT_MS,
				autoCleanIdle: true,
			}),
			connectionString: buildConnectionString(credentials),
		};
		db2Pools.set(key, entry);
	}
	return entry;
}

async function openDb2Connection(credentials: ICredentialDataDecryptedObject) {
	const entry = getDb2Pool(credentials);
	return entry.pool.open(entry.connectionString);
}

/** Closes all cached pools. Useful for graceful application shutdown and tests. */
export async function closeDb2Pools(): Promise<void> {
	const entries = [...db2Pools.values()];
	db2Pools.clear();
	await Promise.all(entries.map(({ pool }) => pool.close()));
}

export async function createPool(credentials: ICredentialDataDecryptedObject) {
	const conn = await openDb2Connection(credentials);
	return {
		nativeConn: conn,
		closeAsync: async () => {
			await conn.close();
		},

		prepareAsync: (sql: string) =>
			new Promise((r, rj) =>
				conn.prepare(sql, (e, stmt) =>
					e
						? rj(e)
						: r({
								executeAsync: (params: any[]) =>
									new Promise((re, rej) =>
										stmt.execute(params, err =>
											err ? rej(err) : re(true),
										),
									),
						  }),
				),
			),

		queryAsync: async (sql: string, params: any[] = []) =>
			(await conn.query(sql, params)) as IDataObject[],
		beginTransaction: async () => {
			await conn.beginTransaction();
		},
		commitTransaction: async () => {
			await conn.commitTransaction();
		},
		rollbackTransaction: async () => {
			await conn.rollbackTransaction();
		},
	};
}

/**
 * Test Connection for Credentials UI
 */
export async function testConnection(credentials: ICredentialDataDecryptedObject): Promise<void> {
	await queryAsync(credentials, 'SELECT 1 FROM SYSIBM.SYSDUMMY1');
}

function schemaColumnSql(): string {
	return `SELECT COLNAME, TYPENAME FROM SYSCAT.COLUMNS WHERE TABSCHEMA = ? AND TABNAME = ? WITH UR`;
}

async function loadTableSchema(
	credential: ICredentialDataDecryptedObject,
	table: string,
): Promise<Record<string, ColumnSchema>> {
	const schemaName = resolveSchema(credential);
	const tableName = assertIdent(table, 'table').toUpperCase();
	const schemaRows = await queryAsync(credential, schemaColumnSql(), [
		schemaName,
		tableName,
	]);

	if (!schemaRows.length) {
		throw new Error(`Table "${schemaName}"."${tableName}" not found`);
	}

	return buildSchemaMap(schemaRows);
}

function getAllowUnsafeSql(ctx: IExecuteFunctions): boolean {
	return ctx.getNodeParameter('allowUnsafeSql', 0, false) as boolean;
}

// ======================================================
// CREATE (BULK INSERT)
// ======================================================
export async function createItems(
	ctx: IExecuteFunctions,
	credential: ICredentialDataDecryptedObject,
	table: string,
): Promise<INodeExecutionData[]> {
	const rows = ctx.getNodeParameter('columnUI', 0, {}) as any;
	const allowUnsafeSql = getAllowUnsafeSql(ctx);

	if (!rows.items?.length) {
		throw new NodeOperationError(ctx.getNode(), 'No insert rows provided');
	}

	let schema: Record<string, ColumnSchema>;
	try {
		schema = await loadTableSchema(credential, table);
	} catch (e) {
		throw new NodeOperationError(ctx.getNode(), (e as Error).message);
	}

	const qualifiedTable = qualifyTable(resolveSchema(credential), table);
	const columnOrder: string[] = [];
	const valueRows: any[][] = [];

	try {
		for (const row of rows.items) {
			const fields = row.columns?.fields ?? [];
			if (!fields.length) continue;

			const currentRow: Record<string, any> = {};

			for (const col of fields) {
				if (col.mode !== 'column') {
					throw new NodeOperationError(
						ctx.getNode(),
						'Custom SQL fields are not supported for inserts',
					);
				}
				const colName = col.columnId;

				if (!colName) {
					throw new NodeOperationError(ctx.getNode(), 'Column name missing');
				}

				const columnIds = String(colName)
					.toUpperCase()
					.split(',')
					.map((c: string) => c.trim())
					.filter(Boolean);

				const values =
					col.columnValue !== undefined && col.columnValue !== null
						? String(col.columnValue)
								.split(',')
								.map((v: string) => v.trim())
						: [];

				if (values.length && values.length !== columnIds.length) {
					throw new NodeOperationError(
						ctx.getNode(),
						`Column/value count mismatch: [${columnIds.join(',')}] vs [${values.join(',')}]`,
					);
				}

				for (let i = 0; i < columnIds.length; i++) {
					const colId = assertIdent(columnIds[i], 'column').toUpperCase();
					const schemaInfo = schema[colId];
					if (!schemaInfo) {
						throw new NodeOperationError(ctx.getNode(), `Unknown column "${colId}"`);
					}
					const raw = values[i] ?? null;

					currentRow[colId] =
						raw === null ? null : autoCast(raw, schemaInfo);
				}
			}
			if (valueRows.length === 0) {
				columnOrder.push(...Object.keys(currentRow));
			} else if (
				Object.keys(currentRow).length !== columnOrder.length ||
				columnOrder.some(column => !(column in currentRow))
			) {
				throw new NodeOperationError(
					ctx.getNode(),
					'Every insert row must contain the same columns',
				);
			}

			valueRows.push(columnOrder.map(col => currentRow[col] ?? null));
		}

		if (!valueRows.length) {
			return [];
		}

		const { sqlParts, params } = buildValues(valueRows, allowUnsafeSql);

		const sql = `
			SELECT * FROM FINAL TABLE(
				INSERT INTO ${qualifiedTable} (${columnOrder.map(c => quoteIdent(c, 'column')).join(', ')})
				VALUES ${sqlParts}
			)
		`;

		const results = await queryAsync(credential, sql, params);

		return results.map(r => ({ json: r }));
	} catch (e) {
		if (e instanceof NodeOperationError) throw e;
		throw new NodeOperationError(
			ctx.getNode(),
			`Insert failed:\n${(e as Error).message}`,
		);
	}
}

// ======================================================
// UPDATE
// ======================================================
export async function updateItems(
	ctx: IExecuteFunctions,
	credential: ICredentialDataDecryptedObject,
	table: string,
): Promise<INodeExecutionData[]> {
	const rows = ctx.getNodeParameter('columnUI', 0, {}) as any;
	const allowUnsafeSql = getAllowUnsafeSql(ctx);

	if (!rows.items?.length) {
		throw new NodeOperationError(ctx.getNode(), 'No update rows provided');
	}

	let schema: Record<string, ColumnSchema>;
	try {
		schema = await loadTableSchema(credential, table);
	} catch (e) {
		throw new NodeOperationError(ctx.getNode(), (e as Error).message);
	}

	const qualifiedTable = qualifyTable(resolveSchema(credential), table);
	const out: INodeExecutionData[] = [];
	let sql = '';

	for (let i = 0; i < rows.items.length; i++) {
		const row = rows.items[i];

		try {
			const colParts: string[] = [];
			const colValues: any[] = [];

			const fields = row.columns?.fields ?? [];
			for (const col of fields) {
				if (col.mode === 'column') {
					if (!col.columnId) {
						throw new NodeOperationError(ctx.getNode(), 'Column name missing');
					}

					if (col.columnId === '*') continue;

					const columnId = assertIdent(col.columnId, 'column').toUpperCase();
					const schemaInfo = schema[columnId];
					if (!schemaInfo) {
						throw new NodeOperationError(ctx.getNode(), `Unknown column "${columnId}"`);
					}

					const value =
						col.columnValue === undefined || col.columnValue === null
							? null
							: autoCast(col.columnValue, schemaInfo);

					colParts.push(`${quoteIdent(columnId, 'column')} = ?`);
					colValues.push(value);
				} else {
					if (!col.sqlExpression) {
						throw new NodeOperationError(ctx.getNode(), 'SQL expression is empty');
					}
					assertSafeSqlFragment(allowUnsafeSql, col.sqlExpression, 'Custom SQL field');
					colParts.push(col.sqlExpression);
				}
			}

			if (!colParts.length) {
				throw new NodeOperationError(ctx.getNode(), 'No columns to update');
			}

			const additionalConditions = ctx.getNodeParameter('additionalConditions', 0, {}) as any;
			const whereGroups = normalizeUiWhere(additionalConditions);
			assertSafeWhereGroups(whereGroups, allowUnsafeSql);

			if (!whereGroups?.length) {
				throw new NodeOperationError(
					ctx.getNode(),
					'Update operation requires at least one WHERE condition.',
				);
			}

			const { sql: whereSql, values: whereValues } = buildWhereClause(
				whereGroups,
				schema,
			);
			if (!whereSql) {
				throw new NodeOperationError(
					ctx.getNode(),
					'Update operation requires at least one valid WHERE condition.',
				);
			}

			sql = `
				UPDATE ${qualifiedTable}
				SET ${colParts.join(', ')}
				${whereSql}
			`;

			const params = [...colValues, ...whereValues];

			await queryAsync(credential, sql, params);

			out.push({
				json: {
					row: i + 1,
					success: true,
				},
			});
		} catch (e) {
			const errorPayload = {
				row: i + 1,
				sql,
				success: false,
				error: (e as Error).message,
			};
			out.push({ json: errorPayload });
		}
	}

	return out;
}

// ======================================================
// DELETE (SAFE)
// ======================================================
export async function deleteItems(
	ctx: IExecuteFunctions,
	credential: ICredentialDataDecryptedObject,
	table: string,
): Promise<INodeExecutionData[]> {
	const allowUnsafeSql = getAllowUnsafeSql(ctx);

	let schema: Record<string, ColumnSchema>;
	try {
		schema = await loadTableSchema(credential, table);
	} catch (e) {
		throw new NodeOperationError(ctx.getNode(), (e as Error).message);
	}

	const qualifiedTable = qualifyTable(resolveSchema(credential), table);
	const additionalConditions = ctx.getNodeParameter('additionalConditions', 0, {}) as any;
	const whereGroups: WhereGroup[] = normalizeUiWhere(additionalConditions);
	assertSafeWhereGroups(whereGroups, allowUnsafeSql);

	if (!whereGroups?.length) {
		throw new NodeOperationError(
			ctx.getNode(),
			'Delete operation requires at least one WHERE condition.',
		);
	}
	const { sql: whereSql, values: rawValues } = buildWhereClause(whereGroups, schema);
	if (!whereSql) {
		throw new NodeOperationError(
			ctx.getNode(),
			'Delete operation requires at least one valid WHERE condition.',
		);
	}
	const sql = `
		DELETE FROM ${qualifiedTable}
		${whereSql}
	`;

	try {
		await queryAsync(credential, sql, rawValues);

		return [
			{
				json: {
					success: true,
					deleted: true,
				},
			},
		];
	} catch (e) {
		throw new NodeOperationError(
			ctx.getNode(),
			`Delete failed:\n${(e as Error).message}`,
			{
				description: JSON.stringify(
					{
						sql,
						params: rawValues,
					},
					null,
					2,
				),
			},
		);
	}
}

function normalizeSelectUi(rawFields: any[]): SelectItem[] {
	if (!Array.isArray(rawFields) || !rawFields.length) return [];

	return rawFields.map((f): SelectItem => {
		const mode = f.mode ?? 'column';
		const alias = f.alias?.trim() || undefined;

		if (mode === 'aggregate') {
			return {
				mode: 'aggregate',
				aggregateSelect: {
					fn: f.fn ?? 'COUNT',
					field: f.column || undefined,
					distinct: !!f.distinct,
					alias,
				},
			};
		}
		if (mode === 'custom') {
			return {
				mode: 'custom',
				customSql: {
					expression: f.expression ?? '',
					alias,
				},
			};
		}
		return {
			mode: 'column',
			columnSelect: {
				column: f.column || '*',
				alias,
			},
		};
	});
}

export async function getItems(
	ctx: IExecuteFunctions,
	credentials: ICredentialDataDecryptedObject,
	table: string,
): Promise<INodeExecutionData[]> {
	const allowUnsafeSql = getAllowUnsafeSql(ctx);
	const selectItems = normalizeSelectUi(
		(ctx.getNodeParameter('select.fields', 0, []) as any[]) ?? [],
	);

	let schema: Record<string, ColumnSchema>;
	try {
		schema = await loadTableSchema(credentials, table);
	} catch (e) {
		throw new NodeOperationError(ctx.getNode(), (e as Error).message);
	}

	const qualifiedTable = qualifyTable(resolveSchema(credentials), table);

	for (const item of selectItems) {
		if (item.mode === 'custom') {
			assertSafeSqlFragment(
				allowUnsafeSql,
				item.customSql?.expression,
				'Custom SELECT expression',
			);
		}
	}

	const selectClause = buildSelectClause(selectItems, schema);

	const additionalConditions = ctx.getNodeParameter('additionalConditions', 0, {}) as any;
	const whereGroups: WhereGroup[] = normalizeUiWhere(additionalConditions);
	assertSafeWhereGroups(whereGroups, allowUnsafeSql);
	const { sql: whereSql, values: whereValues } = buildWhereClause(whereGroups, schema);

	const groupBy =
		(ctx.getNodeParameter('groupBy', 0, {}) as {
			items?: Array<{ mode: string; column?: string; expression?: string }>;
		}) ?? {};
	if (groupBy.items?.some(g => g.mode === 'expression')) {
		for (const g of groupBy.items) {
			if (g.mode === 'expression') {
				assertSafeSqlFragment(allowUnsafeSql, g.expression, 'GROUP BY expression');
			}
		}
	}
	const groupBySql = buildGroupBy(groupBy, schema);

	const havingCondition = (ctx.getNodeParameter('having', 0, {}) as any) ?? null;
	if (havingCondition?.fields?.some((h: any) => h.mode === 'expression')) {
		for (const h of havingCondition.fields) {
			if (h.mode === 'expression') {
				assertSafeSqlFragment(allowUnsafeSql, h.expression, 'HAVING expression');
			}
		}
	}
	const { sql: havingSql, values: havingValues } = buildHaving(havingCondition, schema);

	const orderBy = (ctx.getNodeParameter('orderBy', 0, {}) as any) ?? null;
	if (orderBy?.fields?.some((g: any) => g.mode === 'expression')) {
		for (const g of orderBy.fields) {
			if (g.mode === 'expression') {
				assertSafeSqlFragment(allowUnsafeSql, g.expression, 'ORDER BY expression');
			}
		}
	}
	const orderBySQL = buildOrderBy(orderBy, schema);

	const rowLimit = ctx.getNodeParameter('rowLimit', 0, 1000) as number;
	const limitSql = buildLimit(rowLimit);

	const sql = `
		SELECT ${selectClause}
		FROM ${qualifiedTable}
		${whereSql}
		${groupBySql}
		${havingSql.trim() === 'HAVING' ? '' : havingSql}
		${orderBySQL.trim() === 'ORDER BY' ? '' : orderBySQL}
		${limitSql} WITH UR
	`;
	const values = [...whereValues, ...havingValues];

	const rows = await queryAsync(credentials, sql, values);

	return rows.map(
		(row): INodeExecutionData => ({
			json: row,
		}),
	);
}

/* ---------------------------------- */
/* Queries */
/* ---------------------------------- */

export function resolveTable(tableId: any): string {
	const raw = tableId?.value ?? tableId;
	return assertIdent(String(raw ?? ''), 'table');
}

function buildValues(rows: any[][], allowUnsafeSql: boolean) {
	const sqlParts: string[] = [];
	const params: any[] = [];

	for (const row of rows) {
		const parts: string[] = [];

		for (const v of row) {
			if (typeof v === 'string') {
				const literal = normalizeSafeInsertLiteral(v);
				if (literal) {
					parts.push(literal);
					continue;
				}
				// Reject former isDb2Expression path that inlined arbitrary FOO(...)
				if (/[A-Za-z_]+\s*\(.*\)/.test(v.trim()) && !allowUnsafeSql) {
					throw new Error(
						`Refusing to inline SQL-like value "${v}". Use a bound value, a safe literal (CURRENT_TIMESTAMP / CURRENT_DATE / CURRENT_TIME), or enable Allow Unsafe SQL.`,
					);
				}
				if (/[A-Za-z_]+\s*\(.*\)/.test(v.trim()) && allowUnsafeSql) {
					parts.push(v.trim());
					continue;
				}
			}
			parts.push('?');
			params.push(v ?? null);
		}

		sqlParts.push(`(${parts.join(', ')})`);
	}

	return { sqlParts: sqlParts.join(', '), params };
}

export function autoCast(value: any, col?: ColumnSchema) {
	if (value === '' || value === undefined) return null;

	if (!col) return value;

	if (typeof value === 'string' && normalizeSafeInsertLiteral(value)) {
		return value.trim();
	}

	if (col.isNumeric) {
		if (isNaN(Number(value))) throw new Error(`Value "${value}" is not numeric`);
		return Number(value);
	}

	if (col.isDate) {
		const d = new Date(value);
		if (isNaN(d.getTime())) throw new Error(`Invalid date: ${value}`);
		return d.toISOString().slice(0, 19).replace('T', ' ');
	}

	if (typeof value === 'string' && value.startsWith('[')) {
		try {
			const arr = JSON.parse(value);
			return JSON.stringify(arr);
		} catch {
			/* keep original string */
		}
	}

	return value;
}

export function queryAsync(
	credentials: ICredentialDataDecryptedObject,
	sql: string,
	params: any[] = [],
): Promise<any[]> {
	return (async () => {
		const conn = await openDb2Connection(credentials);
		try {
			return (await conn.query(sql, params)) as any[];
		} finally {
			await conn.close();
		}
	})();
}

/* ---------------------------------- */
/* Utils */
/* ---------------------------------- */

export function getConnectionString(c: ICredentialDataDecryptedObject): string {
	return buildConnectionString(c);
}
