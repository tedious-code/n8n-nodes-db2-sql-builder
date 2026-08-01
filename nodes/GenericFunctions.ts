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
	qualifyTable,
	quoteIdent,
	resolveSchema,
	toConnectionOptions,
} from './sqlSafety';
import {
	ConnectionFactory,
	getAdapter,
	getRegisteredProvider,
	type FoxTableSchema,
} from './foxSchema';

const DIALECT = 'db2';

/* ---------------------------------- */
/* Connection (via @foxschema/core) */
/* ---------------------------------- */

export async function createPool(credentials: ICredentialDataDecryptedObject) {
	const options = toConnectionOptions(credentials);
	const connection = await ConnectionFactory.create(DIALECT, options);
	const adapter = getAdapter(DIALECT);

	return {
		nativeConn: connection,
		closeAsync: async () => {
			await ConnectionFactory.close(DIALECT, connection);
		},
		queryAsync: async (sql: string, params: any[] = []) => {
			return (await adapter.query(connection, sql, params)) as IDataObject[];
		},
		beginTransaction: async () => {
			await adapter.beginTransaction(connection);
		},
		commitTransaction: async () => {
			await adapter.commitTransaction(connection);
		},
		rollbackTransaction: async () => {
			await adapter.rollbackTransaction(connection);
		},
	};
}

/** Closes all foxSchema pools (ibm_db under the hood). */
export async function closeDb2Pools(): Promise<void> {
	await ConnectionFactory.closeAll();
}

export async function closeAllPools(): Promise<void> {
	await ConnectionFactory.closeAll();
}

/**
 * Test Connection for Credentials UI
 */
export async function testConnection(credentials: ICredentialDataDecryptedObject): Promise<void> {
	const provider = getRegisteredProvider(DIALECT);
	const ok = await provider.testConnection(toConnectionOptions(credentials));
	if (!ok) {
		throw new Error('Db2 connection test failed');
	}
}

export async function loadObjectSchemas(
	credentials: ICredentialDataDecryptedObject,
): Promise<FoxTableSchema[]> {
	const provider = getRegisteredProvider(DIALECT);
	const schema = resolveSchema(credentials);
	if (!provider.getTables) {
		throw new Error('Db2 provider does not support getTables()');
	}
	return provider.getTables(toConnectionOptions(credentials), schema);
}

function columnSchemaFromObject(obj: FoxTableSchema): Record<string, ColumnSchema> {
	const map: Record<string, ColumnSchema> = {};
	for (const col of obj.columns ?? []) {
		const type = String(col.type ?? '').toUpperCase();
		const entry: ColumnSchema = {
			name: col.name,
			type,
			isNumeric: /INT|DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL|NUMBER|MONEY|SERIAL/.test(type),
			isDate: /DATE|TIME|TIMESTAMP/.test(type),
			isString: /CHAR|TEXT|CLOB|XML|JSON|UUID|STRING/.test(type),
		};
		map[col.name] = entry;
		map[col.name.toUpperCase()] = entry;
	}
	return map;
}

async function loadTableSchema(
	credential: ICredentialDataDecryptedObject,
	table: string,
): Promise<Record<string, ColumnSchema>> {
	const objects = await loadObjectSchemas(credential);
	const tableName = assertIdent(table, 'table');
	const obj = objects.find(
		o =>
			(o.objectType === 'TABLE' || o.objectType === 'VIEW' || o.objectType === 'MQT') &&
			o.name.toUpperCase() === tableName.toUpperCase(),
	);
	if (!obj) {
		const schemaName = resolveSchema(credential);
		throw new Error(`Table/view "${schemaName}"."${tableName}" not found`);
	}
	const map = columnSchemaFromObject(obj);
	if (!Object.keys(map).length) {
		throw new Error(`No columns found for "${tableName}"`);
	}
	return map;
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
	return ConnectionFactory.executeQuery(DIALECT, toConnectionOptions(credentials), sql, params);
}

/* ---------------------------------- */
/* Utils */
/* ---------------------------------- */

export function getConnectionString(c: ICredentialDataDecryptedObject): string {
	return buildConnectionString(c);
}
