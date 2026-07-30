import { WhereCondition, WhereGroup, ConditionOperator } from '../type/where.condition';
import { ColumnSchema } from '../type';
import { quoteIdent } from '../sqlSafety';

export function buildWhereClause(
	input?: WhereGroup | WhereGroup[],
	schema?: Record<string, ColumnSchema>,
): { sql: string; values: any[] } {
	if (!input) return { sql: '', values: [] };
	if (!schema) {
		throw new Error('Schema is required to build WHERE clause');
	}

	const groups = Array.isArray(input) ? input : [input];
	const parts: string[] = [];
	const values: any[] = [];
	let firstGroup = true;

	for (const group of groups) {
		if (!group || (!group.conditions?.length && !group.groups?.length)) continue;

		const segParts: string[] = [];
		const segValues: any[] = [];
		const joiner = group.filterType === 'OR' ? 'OR' : 'AND';

		for (const cond of group.conditions ?? []) {
			const res = buildCondition(cond, schema);
			if (!res.sql) continue;
			segParts.push(res.sql);
			segValues.push(...res.values);
		}

		if (segParts.length) {
			if (!firstGroup) parts.push(joiner);
			parts.push(`(${segParts.join(` ${joiner} `)})`);
			values.push(...segValues);
			firstGroup = false;
		}
	}

	if (!parts.length) return { sql: '', values: [] };
	return {
		sql: `WHERE ${parts.join(' ')}`,
		values,
	};
}

export function castValue(col: ColumnSchema, value: any) {
	if (value === null || value === undefined) {
		return null;
	}

	if (typeof value === 'string') {
		let v = value.trim();
		if (
			(v.startsWith("'") && v.endsWith("'")) ||
			(v.startsWith('"') && v.endsWith('"'))
		) {
			v = v.slice(1, -1);
		}
		value = v;
	}

	if (col.isNumeric) {
		const num = Number(value);
		if (Number.isNaN(num)) {
			throw new Error(`Column "${col.name}" expects NUMBER, got "${value}"`);
		}
		return num;
	}

	if (col.isDate) {
		if (typeof value !== 'string') {
			throw new Error(`Column "${col.name}" expects DATE string`);
		}
		return value;
	}
	return String(value);
}

function resolveColumn(
	cond: { column: string },
	schema: Record<string, ColumnSchema>,
): ColumnSchema {
	if (cond.column === '*') {
		throw new Error('Column "*" is not valid in this condition');
	}
	const key = String(cond.column).toUpperCase();
	const column = schema[key] ?? schema[cond.column];
	if (!column) {
		throw new Error(`Unknown column "${cond.column}"`);
	}
	return column;
}

export function buildCondition(
	cond: WhereCondition,
	schema: Record<string, ColumnSchema>,
): { sql: string; values: any[] } {
	switch (cond.mode) {
		case 'column': {
			const column = resolveColumn(cond, schema);
			const op = String(cond.operator ?? '').toUpperCase();
			const colSql = quoteIdent(column.name, 'column');

			switch (op) {
				case 'EQUAL':
				case 'NOT_EQUAL':
				case 'GREATER':
				case 'LESS':
				case 'GREATER_EQUAL':
				case 'LESS_EQUAL':
					return {
						sql: `${colSql} ${operatorTranslate(op)} ?`,
						values: [castValue(column, cond.value)],
					};
				case 'LIKE':
					if (!column.isString) {
						throw new Error('LIKE only allowed on string column');
					}
					return {
						sql: `${colSql} LIKE ?`,
						values: [String(cond.value ?? '')],
					};
				case 'CONTAINS':
					if (!column.isString) {
						throw new Error('CONTAINS only allowed on string column');
					}
					return {
						sql: `${colSql} LIKE ?`,
						values: [`%${cond.value ?? ''}%`],
					};
				case 'NOT_LIKE':
					if (!column.isString) {
						throw new Error('NOT LIKE only allowed on string column');
					}
					return {
						sql: `${colSql} NOT LIKE ?`,
						values: [String(cond.value ?? '')],
					};
				case 'IS_NULL':
					return { sql: `${colSql} IS NULL`, values: [] };
				case 'IS_NOT_NULL':
					return { sql: `${colSql} IS NOT NULL`, values: [] };
				default:
					throw new Error(`Unsupported operator "${cond.operator}"`);
			}
		}
		case 'exists': {
			if (!cond.sql?.trim()) {
				throw new Error('EXISTS query is required');
			}
			return { sql: `EXISTS (${cond.sql})`, values: [] };
		}
		case 'not_exists': {
			if (!cond.sql?.trim()) {
				throw new Error('NOT EXISTS query is required');
			}
			return { sql: `NOT EXISTS (${cond.sql})`, values: [] };
		}
		case 'column_in': {
			if (!cond.values?.length) {
				throw new Error('IN requires values');
			}
			const column = resolveColumn(cond, schema);
			return {
				sql: `${quoteIdent(column.name, 'column')} IN (${cond.values.map(() => '?').join(', ')})`,
				values: cond.values.map(v => castValue(column, v)),
			};
		}
		case 'column_not_in': {
			if (!cond.values?.length) {
				throw new Error('NOT IN requires values');
			}
			const column = resolveColumn(cond, schema);
			return {
				sql: `${quoteIdent(column.name, 'column')} NOT IN (${cond.values.map(() => '?').join(', ')})`,
				values: cond.values.map(v => castValue(column, v)),
			};
		}
		case 'between': {
			if (!cond.values || cond.values.length !== 2) {
				throw new Error('BETWEEN requires exactly 2 values');
			}
			const column = resolveColumn(cond, schema);
			return {
				sql: `${quoteIdent(column.name, 'column')} BETWEEN ? AND ?`,
				values: [castValue(column, cond.values[0]), castValue(column, cond.values[1])],
			};
		}
		case 'not_between': {
			if (!cond.values || cond.values.length !== 2) {
				throw new Error('NOT BETWEEN requires exactly 2 values');
			}
			const column = resolveColumn(cond, schema);
			return {
				sql: `${quoteIdent(column.name, 'column')} NOT BETWEEN ? AND ?`,
				values: [castValue(column, cond.values[0]), castValue(column, cond.values[1])],
			};
		}
		case 'expression': {
			if (!cond.sql?.trim()) {
				throw new Error('SQL expression is required');
			}
			return { sql: `(${cond.sql})`, values: [] };
		}
		case 'subquery_in':
		case 'subquery_not_in': {
			if (!cond.sql?.trim()) {
				throw new Error('Subquery SQL is required');
			}
			const column = resolveColumn(cond, schema);
			const kw = cond.mode === 'subquery_in' ? 'IN' : 'NOT IN';
			return {
				sql: `${quoteIdent(column.name, 'column')} ${kw} (${cond.sql})`,
				values: [],
			};
		}
		default:
			throw new Error('Unsupported WHERE condition mode');
	}
}

function splitCsv(values?: string): string[] | undefined {
	if (!values?.trim()) return undefined;
	return values.split(',').map((v: string) => v.trim()).filter(Boolean);
}

export function normalizeUiWhere(additionalConditions: any): WhereGroup[] {
	const result: WhereGroup[] = [];
	if (!additionalConditions?.groups?.length) return result;

	for (const g of additionalConditions.groups) {
		const fields = g.filters?.fields ?? [];
		const conditions: WhereCondition[] = [];

		for (const f of fields) {
			const column = f.field ? String(f.field).toUpperCase() : f.field;

			switch (f.mode) {
				case 'column':
					conditions.push({
						mode: 'column',
						column,
						operator: String(f.operator ?? 'equal').toUpperCase() as ConditionOperator,
						value: f.value,
					});
					break;
				case 'column_in':
				case 'column_not_in':
				case 'between':
				case 'not_between':
					conditions.push({
						mode: f.mode,
						column,
						operator: String(f.operator ?? f.mode).toUpperCase() as ConditionOperator,
						values: splitCsv(f.values),
					});
					break;
				case 'exists':
				case 'not_exists':
					conditions.push({
						mode: f.mode,
						operator: f.mode === 'exists' ? 'EXISTS' : 'NOT EXISTS',
						sql: f.existsQuery,
					});
					break;
				case 'expression':
					conditions.push({
						mode: 'expression',
						sql: f.expression,
					});
					break;
			}
		}

		result.push({
			filterType: g.filterType === 'OR' ? 'OR' : 'AND',
			conditions,
		});
	}
	return result;
}

function operatorTranslate(operator: string) {
	switch (operator.toUpperCase()) {
		case 'EQUAL':
			return '=';
		case 'NOT_EQUAL':
			return '<>';
		case 'GREATER':
			return '>';
		case 'LESS':
			return '<';
		case 'GREATER_EQUAL':
			return '>=';
		case 'LESS_EQUAL':
			return '<=';
		default:
			throw new Error(`Unsupported compare operator "${operator}"`);
	}
}
