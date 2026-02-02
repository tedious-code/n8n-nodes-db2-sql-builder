import * as ibm_db from 'ibm_db';
import {
	type IDataObject,
	type ICredentialDataDecryptedObject,
	type INodeExecutionData,
	type IExecuteFunctions,
	NodeOperationError,
} from 'n8n-workflow';
import {  ColumnSchema, SelectItem, WhereGroup } from './type';
import { buildGroupBy, buildHaving, buildOrderBy, buildSchemaMap, buildSelectClause, buildWhereClause, normalizeUiWhere } from './builder';

/* ---------------------------------- */
/* Connection */
/* ---------------------------------- */

export async function createPool(credentials: ICredentialDataDecryptedObject) {
	const connStr = getConnectionString(credentials);

	return new Promise<any>((resolve, reject) => {
		ibm_db.open(connStr, (err, conn) => {
			if (err) return reject(err);
			resolve({
				nativeConn: conn,
				closeAsync: () =>
					new Promise<void>((r, rj) => conn.close(e => (e ? rj(e) : r()))),

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

				queryAsync: (sql: string) =>
					new Promise<IDataObject[]>((r, rj) =>
						conn.query(sql, (e, d: any) => (e ? rj(e) : r(d))),
					),
			});
		});
	});
}
/**
 * Test Connection for Credentials UI
 */
export async function testConnection(credentials: ICredentialDataDecryptedObject): Promise<void> {
	const connStr = getConnectionString(credentials);
	return new Promise((resolve, reject) => {
		ibm_db.open(connStr, (err: Error, conn: any) => {
			if (err) {
				return reject(err);
			}
			conn.query("SELECT 1 FROM SYSIBM.SYSDUMMY1", (e: Error, rows: any[]) => {
				conn.close(() => {});
				if (e) return reject(e);
				if (!rows || rows.length === 0) {
					return resolve();
				}
				console.info("✅ Test Query Result");
			});

			conn.close(() => resolve());
		});
	});
}

// ======================================================
// CREATE (BULK INSERT)
// ======================================================
export async function createItems(
	ctx: IExecuteFunctions,
	credential: ICredentialDataDecryptedObject,
	table: string,
): Promise<INodeExecutionData[]> {
	const onlySelect  = (ctx.getNodeParameter('onlySelect', 0, false) as boolean) ?? false;

	if(onlySelect) {
		throw new NodeOperationError(
			ctx.getNode(),
			'Only SELECT is allowed.',
		);
	}
	const rows = ctx.getNodeParameter('columnUI', 0, {}) as any;

	if (!rows.items?.length) {
		throw new NodeOperationError(ctx.getNode(), 'No insert rows provided');
	}

	// Load schema
	const schemaRows = await queryAsync(
		getConnectionString(credential),
		`SELECT COLNAME, TYPENAME FROM SYSCAT.COLUMNS WHERE TABNAME = ? WITH UR`,
		[table.toUpperCase()],
	);

	if (!schemaRows.length) {
		throw new NodeOperationError(ctx.getNode(), `Table "${table}" not found`);
	}

	const schema = buildSchemaMap(schemaRows);

	const columnOrder: string[] = [];
	const valueRows: any[][] = [];

	try {
		for (const row of rows.items) {
			const fields = row.columns?.fields ?? [];
			if (!fields.length) continue;

			const currentRow: Record<string, any> = {};

			for (const col of fields) {
				const colName =
					col.mode === 'column' ? col.columnId : col.expression;

				if (!colName) {
					throw new NodeOperationError(ctx.getNode(), 'Column name missing');
				}

				const columnIds = colName
					.toUpperCase()
					.split(',')
					.map((c: string) => c.trim())
					.filter(Boolean);

				const values = col.columnValue !== undefined && col.columnValue !== null
					? col.columnValue.split(',').map((v: string) => v.trim())
					: [];

				if (values.length && values.length !== columnIds.length) {
					throw new NodeOperationError(
						ctx.getNode(),
						`Column/value count mismatch: [${columnIds.join(',')}] vs [${values.join(',')}]`,
					);
				}

				for (let i = 0; i < columnIds.length; i++) {
					const colId = columnIds[i];
					const schemaInfo = schema[colId];
					const raw = values[i] ?? null;

					currentRow[colId] =
						raw === null ? null : autoCast(raw, schemaInfo);

					if (!columnOrder.includes(colId)) {
						columnOrder.push(colId);
					}
				}
			}

			// Build ordered row
			valueRows.push(
				columnOrder.map(col => currentRow[col] ?? null),
			);
		}

		if (!valueRows.length) {
			return [];
		}

		const { sqlParts, params } = buildValues(valueRows);

		const sql = `
			SELECT * FROM FINAL TABLE(
				INSERT INTO ${table} (${columnOrder.map(c => `"${c}"`).join(', ')})
				VALUES ${sqlParts}
			)
		`;
		const results = await secureExecuteQuery(
				queryAsync,
				getConnectionString(credential),
				sql,
				params,
				{
					strict: false,
				},
			);

		return results.map(r => ({ json: r }));

	} catch (e) {
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
const onlySelect  = (ctx.getNodeParameter('onlySelect', 0, false) as boolean) ?? false;

	if(onlySelect) {
		throw new NodeOperationError(
			ctx.getNode(),
			'Only SELECT is allowed.',
		);
	}
	const rows = ctx.getNodeParameter('columnUI', 0, {}) as any;
	if (!rows.items?.length) {
		throw new NodeOperationError(ctx.getNode(), 'No update rows provided');
	}

	// Load schema
	const schemaRows = await queryAsync(
		getConnectionString(credential),
		`SELECT COLNAME, TYPENAME FROM SYSCAT.COLUMNS WHERE TABNAME = ? WITH UR`,
		[table.toUpperCase()],
	);

	if (!schemaRows.length) {
		throw new NodeOperationError(ctx.getNode(), `Table "${table}" not found`);
	}

	const schema = buildSchemaMap(schemaRows);
	const out: INodeExecutionData[] = [];
	let sql: string = '';
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

					const columnId = col?.columnId.toUpperCase();
					const schemaInfo = schema[columnId];

					const value =
						col.columnValue === undefined || col.columnValue === null
							? null
							: autoCast(col.columnValue, schemaInfo);

					colParts.push(`"${columnId}" = ?`);
					colValues.push(value);

				} else {
					if (!col.sqlExpression) {
							throw new NodeOperationError(ctx.getNode(), 'SQL expression is empty');
						}
					// expression
					colParts.push(col.sqlExpression);
				}
			}

			if (!colParts.length) {
				throw new NodeOperationError(ctx.getNode(), 'No columns to update');
			}

			const additionalConditions = ctx.getNodeParameter('additionalConditions', 0, {}) as any;
			const whereGroups = normalizeUiWhere(additionalConditions);

			if (!whereGroups?.length) {
				throw new NodeOperationError(
					ctx.getNode(),
					'Update operation requires at least one WHERE condition.',
				);
			}

			const { sql: whereSql, values: whereValues } =
				buildWhereClause(whereGroups, schema);

			sql = `
				UPDATE ${table}
				SET ${colParts.join(', ')}
				${whereSql}
			`;

			const rawValues = [...colValues, ...whereValues];

			await secureExecuteQuery(
				queryAsync,
				getConnectionString(credential),
				sql,
				rawValues,
				{
					strict: false,
				},
			);

			out.push({
				json: {
					row: i+1,
					success: true,
				},
			});

		} catch (e) {
			const errorPayload = {
				row: i+1,
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
	const onlySelect  = (ctx.getNodeParameter('onlySelect', 0, false) as boolean) ?? false;

	if(onlySelect) {
		throw new NodeOperationError(
			ctx.getNode(),
			'Only SELECT is allowed.',
		);
	}
	// Load schema
	const schemaRows = await queryAsync(
		getConnectionString(credential),
		`SELECT COLNAME, TYPENAME FROM SYSCAT.COLUMNS WHERE TABNAME = ? WITH UR`,
		[table.toUpperCase()],
	);

	if (!schemaRows.length) {
		throw new NodeOperationError(ctx.getNode(), `Table "${table}" not found`);
	}

	const schema = buildSchemaMap(schemaRows);
	const additionalConditions = ctx.getNodeParameter('additionalConditions', 0, {}) as any;
	const whereGroups: WhereGroup[] = normalizeUiWhere(additionalConditions);

	if (!whereGroups?.length) {
		throw new NodeOperationError(
			ctx.getNode(),
			'Delete operation requires at least one WHERE condition.',
		);
	}
	const { sql: whereSql, values: rawValues } =
		buildWhereClause(whereGroups, schema);
	const sql = `
		DELETE FROM ${credential?.schema}.${table}
		${whereSql}
	`;

	try {
	/* ==============================
	   EXECUTE
	================================ */
	await secureExecuteQuery(
		queryAsync,
		getConnectionString(credential),
		sql,
		rawValues,
		{
			strict: false,
		},
	);

	return [{
			json: {
				success: true,
				deleted: true,
			},
		}];

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



export async function getItems(
	ctx: IExecuteFunctions,
	credentials: ICredentialDataDecryptedObject,
	table: string,
): Promise<INodeExecutionData[]> {
	const selectItems = (ctx.getNodeParameter('select.fields', 0, []) as SelectItem[]) ?? [];
	const limit  = (ctx.getNodeParameter('limitSelect', 0, 200) as number) ?? 200;

	/* ================= BUILD SQL ================= */

	const schemaRows = await queryAsync(
		getConnectionString(credentials),
		`SELECT COLNAME, TYPENAME FROM SYSCAT.COLUMNS WHERE TABNAME = ? WITH UR`,
		[table.toUpperCase()],
	);

	if (!schemaRows.length) {
		throw new NodeOperationError(ctx.getNode(), `Table "${table}" not found`);
	}

	const schema = buildSchemaMap(schemaRows);
	const selectClause = buildSelectClause(selectItems, schema);
	/* ==============================
	   WHERE (GROUPED)
	================================ */
	const additionalConditions = ctx.getNodeParameter('additionalConditions', 0, {}) as any
	// console.log('Additional Conditions:', JSON.stringify(additionalConditions, null, 2));
	const whereGroups: WhereGroup[] = normalizeUiWhere(additionalConditions);
	// console.log('Normalized Where Groups:', JSON.stringify(whereGroups, null, 2));	
	const { sql: whereSql, values: whereValues } = buildWhereClause(whereGroups, schema);
	// console.log('Where whereValues:', whereSql);
	/* ==============================
	   GROUP BY
	================================ */
	const groupBy = (ctx.getNodeParameter('groupBy', 0, []) as {items: [ { mode: string, column?: string, expression?: string } ] }) ?? {};
	const groupBySql  = buildGroupBy(groupBy, schema);

	/* ==============================
	   HAVING
	================================ */
	const havingCondition = (ctx.getNodeParameter('having', 0, []) as any) ?? null;
	const { sql: havingSql, values: havingValues } = buildHaving(havingCondition, schema);

	/* ==============================
	   ORDER BY
	================================ */

	const orderBy = (ctx.getNodeParameter('orderBy', 0, []) as any) ?? null;
	const orderBySQL = buildOrderBy(orderBy, schema);

	/* ==============================
	   FINAL SQL
	================================ */
	const sql = `
		SELECT ${selectClause}
		FROM ${credentials.schema}.${table}
		${whereSql}
		${groupBySql}
		${havingSql.trim() === 'HAVING' ? '' : havingSql}
		${orderBySQL.trim() === 'ORDER BY' ? '' : orderBySQL}
		FETCH FIRST ${limit < 1 ? 1: limit} ROWS ONLY WITH UR;
	`;

	const values = [...whereValues, ...havingValues];
	
	/* ==============================
	   EXECUTE
	================================ */
	const rows = await secureExecuteQuery(
		queryAsync,
		getConnectionString(credentials),
		sql,
		values,
		{
			strict: false,
		},
	);

	if (!rows || rows.length === 0) {
		throw new NodeOperationError(
			ctx.getNode(),
			`DB2 query returned no rows (table: ${table}, schema: ${credentials.schema})`)
	}

	return rows.map((row): INodeExecutionData => ({
		json: row,
	}));
}

/* ---------------------------------- */
/* Queries */
/* ---------------------------------- */

export async function executeQuery(conn: any, sql: string) {
	return conn.queryAsync(sql);
}

export function resolveTable(tableId: any): string {
	return tableId?.value ?? tableId;
}

export function buildKeyValue(items: Array<{ columnId: string; columnValue: any }>) {
	return items.reduce<Record<string, any>>((acc, cur) => {
		acc[cur.columnId] = cur.columnValue;
		return acc;
	}, {});
}

export function normalizeRows(rows: Record<string, any>[]) {
	const columns = [...new Set(rows.flatMap(r => Object.keys(r)))];
	const values = rows.map(r => columns.map(c => r[c] ?? null));
	return { columns, values };
}

function isDb2Expression(v: any) {
	if (typeof v !== 'string') return false;

	const t = v.trim().toUpperCase();

	// Any function call with parentheses → expression
	if (/[A-Z_]+\(.*\)/.test(t)) return true;

	// Date/interval arithmetic (DAY/HOUR/etc.)
	if (/\+\s*\d+\s+(DAY|DAYS|HOUR|HOURS|MINUTE|MINUTES)/.test(t)) return true;

	// Bare CURRENT_ constants
	if (/^CURRENT_(TIMESTAMP|DATE)$/.test(t)) return true;

	return false;
}
function normalizeExpr(v: string) {
	return v
		.replace(/^NOW\(\)$/i, 'CURRENT_TIMESTAMP')
		.replace(/^ISNULL/i, 'COALESCE');
}

function buildValues(rows: any[][]) {
	const sqlParts: string[] = [];
	const params: any[] = [];

	for (const row of rows) {
		const parts: string[] = [];

		for (let v of row) {
			if (isDb2Expression(v)) {
				parts.push(normalizeExpr(v));
			} else {
				parts.push('?');
				params.push(v ?? null);
			}
		}

		sqlParts.push(`(${parts.join(', ')})`);
	}

	return { sqlParts: sqlParts.join(', '), params };
}

export function autoCast(value: any, col?: ColumnSchema) {
	if (value === '' || value === undefined) return null;

	if (!col) return value;

	if (col.isNumeric) {
		if (isNaN(Number(value))) throw new Error(`Value "${value}" is not numeric`);
		return Number(value);
	}

	if (col.isDate) {
		const d = new Date(value);
		if (isNaN(d.getTime())) throw new Error(`Invalid date: ${value}`);
		return d.toISOString().slice(0, 19).replace('T', ' ');
	}

	// JSON or array auto-detect
	if (typeof value === 'string' && value.startsWith('[)')) {
		try {
			const arr = JSON.parse(value);
			return JSON.stringify(arr);
		} catch {}
	}

	return value; // string
}


export function queryAsync(
	connStr: string,
	sql: string,
	params: any[] = [],
): Promise<any[]> {

	return new Promise((resolve, reject) => {
		ibm_db.open(connStr, (err, conn) => {
			if (err) {
				return reject(err);
			}
			conn.query(sql, params, (queryErr: Error, rows: any[]) => {
				conn.close(() => {});
				if (queryErr) {
					reject(queryErr);
				} else {
					resolve(rows);
				}
			});
		});
	});
}

/* ---------------------------------- */
/* Utils */
/* ---------------------------------- */

export function getConnectionString(c: ICredentialDataDecryptedObject): string {
	return `DRIVER={DB2};DATABASE=${c.database};HOSTNAME=${c.host};PORT=${c.port};PROTOCOL=TCPIP;UID=${c.username};PWD=${c.password};`;
}

export const SENSITIVE_COLUMNS = [
	'password',
	'passwordhash',
	'passwordsalt',
	'salt',
	'hash',
	'pwd',
	'pass',
	'email',
	'normalizedemail',
	'username',
	'normalizedusername',
	'token',
	'accesstoken',
	'refreshtoken',
	'secret',
	'api_key',
	'privatekey',
];


type SecureExecuteOptions = {
	strict?: boolean;
	maxStringLength?: number;
};

const DEFAULT_OPTIONS: SecureExecuteOptions = {
	strict: false,
	maxStringLength: 4000,
};

/* ==============================
   SECURE EXECUTE QUERY
================================ */
export async function secureExecuteQuery<T = any>(
	queryAsync: Function,
	connectionString: string,
	sql: string,
	values: unknown[] = [],
	options: SecureExecuteOptions = {},
	limit: number = 1,
): Promise<Record<string, any>[]>  {
	const opts = { ...DEFAULT_OPTIONS, ...options };

	if (!Array.isArray(values)) {
		throw new Error('Query values must be an array');
	}
	// Use for insert values or where parameters
	const sanitizedValues = values.map(v =>
		sanitizeValue(v, opts),
	);
	// limit
	sql = sanitizeSelectSQL(sql, limit);
	
	try {
		const rows = await queryAsync(connectionString, sql, sanitizedValues);
		return sanitizeRows(rows)
	} catch (err) {
		throw new Error('Database query failed');
	}
}

// Sanitize values
function sanitizeValue(
	value: unknown,
	options: SecureExecuteOptions,
): unknown {
	if (Array.isArray(value)) {
		return value.map(v => sanitizeValue(v, options));
	}

	if (typeof value === 'object' && value !== null) {
		return Object.fromEntries(
			Object.entries(value).map(([k, v]) => [
				k,
				sanitizeValue(v, options),
			]),
		);
	}

	if (typeof value === 'string') {
		let sanitized = value
			.replace(/[\n\r\t\0]/g, ' ')
			.replace(/[\u0000-\u001F\u007F]/g, '')
			.trim();

		if (options.maxStringLength && sanitized.length > options.maxStringLength) {
			sanitized = sanitized.slice(0, options.maxStringLength);
		}

		if (options.strict) {
			const forbidden = /(union\s+select|drop\s+table|--|;)/i;
			if (forbidden.test(sanitized)) {
				throw new Error('Suspicious input detected');
			}
		}

		return sanitized;
	}

	return value;
}

const SQL_COMMENT = /(--|\/\*)/;
const FORBIDDEN_SQL = /\b(drop|alter|truncate|--|\/\*)\b/i;

export function sanitizeSelectSQL(sql: string, limit: number = 1, allowSelect: boolean = false): string {
	if (!sql || typeof sql !== 'string') {
		throw new Error('Invalid SQL');
	}

	// normalize whitespace & remove control chars
	let normalized = sql
		.replace(/[\u0000-\u001F\u007F]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

	// block comments & dangerous keywords
	if (SQL_COMMENT.test(normalized)) {
		throw new Error('SQL comments are not allowed');
	}

	if (FORBIDDEN_SQL.test(normalized)) {
		throw new Error('Forbidden SQL operation');
	}

	// detect SQL type
	const typeMatch = normalized.match(/^(select|update|delete|insert)\b/i);
	if (!typeMatch) {
		throw new Error('Unsupported SQL operation type');
	}

	const type = typeMatch[1].toLowerCase();

	// ================= SELECT =================
	if (type === 'select') {
		if(/^\s*select\s+\*\s+from\s+final\s+table\s*\(/i.test(normalized)){
			// SELECT * FROM FINAL TABLE ( ... ) - skip
			return normalized;
		}

		if (!/\b(limit\s+\d+|fetch\s+first\s+\d+)\b/i.test(normalized)) {
			// Append LIMIT if not present
			normalized =
				normalized.replace(/;$/, '') +
				` FETCH FIRST ${limit < 1 ? 1 : limit} ROWS ONLY WITH UR;`;
		}
		// Sanitize SELECT columns
		const match = normalized.match(
			/^\s*(select)\s+(.+?)\s+(from\s+.+)$/i
		);

		if (!match) {
			throw new Error('Invalid SQL operation');
		}

		const [, selectKeyword, selectList, restSQL] = match;

		const cleanSelect = sanitizeSelectColumns(selectList);

		return `${selectKeyword.toUpperCase()} ${cleanSelect} ${restSQL}`;
    }
	// ================= UPDATE =================
	else if (type === 'update') {
		if(allowSelect)
			throw new Error('Only SELECT is allowed.');
		// UPDATE must have WHERE
		if (!/\bwhere\b/i.test(normalized)) {
			throw new Error('UPDATE without WHERE is not allowed');
		}

		const match = normalized.match(
			/^\s*update\s+([a-zA-Z0-9_."']+)\s+set\s+(.+?)\s+where\s+(.+)$/i
		);
		if (!match) {
			throw new Error('Invalid UPDATE SQL');
		}

		// sanitize SET clause
		const setClause = match[2];
		const sets = setClause.split(',');

		for (const s of sets) {
			const col = s.split('=')[0].replace(/["`\s]/g, '').toLowerCase();
			if (exports.SENSITIVE_COLUMNS?.includes(col)) {
				throw new Error(`Sensitive column update blocked: ${col}`);
			}
		}
	}
		// ================= DELETE =================

	else if (type === 'insert') {
		if (allowSelect)
			throw new Error('Only SELECT is allowed.');

		const match = normalized.match(
			/^\s*insert\s+into\s+([a-zA-Z0-9_."']+)\s*\(([^)]+)\)\s*(value|values)\s*\(([^)]+)\)\s*$/i
		);

		if (!match) {
			throw new Error('Invalid INSERT SQL');
		}

		const columns = match[2]
		.split(',')
		.map(c => c.replace(/["`\s]/g, '').toLowerCase());

		const values = match[4]
			.split(',')
			.map(v => v.trim());

		// number of columns must match number of values
		if (columns.length !== values.length) {
			throw new Error('Columns count does not match VALUES count');
		}

		for (let i = 0; i < values.length; i++) {
			const col = columns[i];
			if (exports.SENSITIVE_COLUMNS?.includes(col)) {
				throw new Error(`Sensitive column insert blocked: ${col}`);
			}
		}
	}
	// ================= DELETE =================
	else if (type === 'delete') {
		if(allowSelect)
			throw new Error('Only SELECT is allowed.');
		// DELETE must have WHERE
		if (!/\bwhere\b/i.test(normalized)) {
			throw new Error('DELETE without WHERE is not allowed');
		}

		const match = normalized.match(
			/^\s*delete\s+from\s+([a-zA-Z0-9_."']+)\s+where\s+(.+)$/i
		);
		if (!match) {
			throw new Error('Invalid DELETE SQL');
		}

		return normalized;
	}

	throw new Error('Unhandled SQL type');
}

function sanitizeSelectColumns(selectQuery: string): string {
	const parts = selectQuery
		.split(',')
		.map(v => v.trim())
		.filter(Boolean);

	const safeColumns: string[] = [];

	for (let col of parts) {
		// remove quotes: "password" → password
		col = col.replace(/^["`]|["`]$/g, '');

		// alias: password AS pwd
		const [expr] = col.split(/\s+as\s+/i);
		const base = expr.trim().toLowerCase();

		// sensitive column block
		if (exports.SENSITIVE_COLUMNS?.includes(base)) {
			continue;
		}

		// COUNT(Id)
		// const aggMatch = /^(count|sum|max|min|avg)\s*\(\s*([a-zA-Z0-9_.]+|\*)\s*\)$/i.exec(expr);
		const isFinalTableQuery =
		/^\s*select\s+\*\s+from\s+final\s+table\s*\(/i.test(selectQuery);

		const aggMatch =
			/^(count|sum|max|min|avg)\s*\(\s*([a-zA-Z0-9_.]+|\*)\s*\)$/i.exec(expr);

		if (aggMatch) {
			if (isFinalTableQuery) {
				safeColumns.push(expr.toUpperCase());
				continue;
			}

			const target = aggMatch[2].toLowerCase();
			if (
				target !== '*' && // Dont allow "select *"" for sensitive check
				exports.SENSITIVE_COLUMNS?.includes(target)
			) {
				throw new Error(`Sensitive column blocked: ${target}`);
			}

			safeColumns.push(expr.toUpperCase());
			continue;
		}

		// hard validation
		if (/[^a-zA-Z0-9_.]/.test(expr)) {
			throw new Error(`Invalid column: ${expr}`);
		}

		safeColumns.push(expr);
	}

	return safeColumns.join(', ');
}
// Sanitize result records 
export function sanitizeRows(
	rows: Record<string, any>[]
): Record<string, any>[] {
	if (!Array.isArray(rows)) return [];

	const mask = 'sensitive';
	const maskInstead =  true;

	return rows.map(row => {
		const clean: Record<string, any> = {};

		for (const key of Object.keys(row)) {
			const normalizedKey = key.toLowerCase();

			if (SENSITIVE_COLUMNS.includes(normalizedKey)) {
				if (maskInstead) {
					clean[key] = mask;
				}
				continue;
			}
			clean[key] = row[key];
		}

		return clean;
	});
}
