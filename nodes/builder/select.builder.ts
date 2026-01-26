import { INodePropertyOptions } from "n8n-workflow";
import { ColumnSchema, SelectItem } from "../type";

export function buildSchemaMapFromOptions(
	options: INodePropertyOptions[],
): Record<string, ColumnSchema> {

	const map: Record<string, ColumnSchema> = {};
	for (const opt of options) {
		if (typeof opt.value !== 'string') continue;

		const colName = opt.value;
		const type = (opt.description || '').toUpperCase();
		if (!type) continue;

		map[colName] = {
			name: colName,
			type,
			isNumeric: ['INTEGER', 'BIGINT', 'SMALLINT', 'DECIMAL', 'NUMERIC', 'FLOAT', 'DOUBLE'].includes(type),
			isDate: ['DATE', 'TIMESTAMP', 'TIME'].includes(type),
			isString: ['CHAR', 'VARCHAR', 'CLOB'].includes(type),
		};
	}

	return map;
}

export function assertColumn(
	column: string,
	schema: Record<string, ColumnSchema>,
) {
	if(column === '*') {
		return '*';
	}
	if (!schema[column]) {
		throw new Error(`Unknown column "${column}"`);
	}
	return `"${column}"`;
}

export function buildSelectExpr(
	item: SelectItem,
	schema: Record<string, ColumnSchema>,
): string {
	switch (item.mode) {

		/* ================= COLUMN ================= */
		case 'column': {
			const { column, alias } = item.columnSelect!;
			const col = assertColumn(column, schema);
			return alias ? `${col} AS "${alias}"` : col;
		}

		/* ================= AGGREGATE ================= */
		case 'aggregate': {
			const { fn, field, distinct, alias } =
				item.aggregateSelect!;

			let expr: string;

			if (fn === 'COUNT') {
				expr = field
					? `${distinct ? 'DISTINCT ' : ''}${assertColumn(field, schema)}`
					: '*';
			} else {
				const col = schema[field!];
				if (!col) {
					throw new Error(`Unknown aggregate column "${field}"`);
				}
				if (['SUM', 'AVG'].includes(fn) && !col.isNumeric) {
					throw new Error(
						`Cannot ${fn} on non-numeric column "${field}"`,
					);
				}
				expr =
					fn === 'SUM' || fn === 'AVG'
						? `DECIMAL("${field}", 18, 2)`
						: `"${field}"`;
			}

			const finalAlias =
				alias?.trim() ||
				`${fn.toLowerCase()}_${field ?? 'all'}`;

			return `${fn}(${expr}) AS "${finalAlias}"`;
		}

		/* ================= CUSTOM ================= */
		case 'custom': {
			const { expression, alias } = item.customSql!;
			if (!expression?.trim()) {
				throw new Error(`Custom SQL expression is required`);
			}
			return alias
				? `${expression} AS "${alias}"`
				: expression;
		}

		default:
			throw new Error(`Unsupported select mode`);
	}
}
 
export function buildSelectClause(
	selectItems: SelectItem[],
	schema: Record<string, ColumnSchema>,
): string {
	
	if (!selectItems.length) {
		selectItems.push({mode: "column", columnSelect: {column: '*' }})
	}

	return selectItems
		.map(item => buildSelectExpr(item, schema))
		.join(', ');
}

export function buildSchemaMap(rows: any[]): Record<string, ColumnSchema> {
	const map: Record<string, ColumnSchema> = {};

	for (const r of rows) {
		if(r.COLNAME == '*') {
			map[r.COLNAME] = {
				name: r.COLNAME,
				type: null,
				isNumeric: null,
				isDate: null,
				isString: null,
				};
			continue;
		}

		const type = r.TYPENAME.toUpperCase();
		map[r.COLNAME] = {
			name: r.COLNAME,
			type,
			isNumeric: ['INTEGER', 'BIGINT', 'SMALLINT', 'DECIMAL', 'NUMERIC', 'FLOAT', 'DOUBLE'].includes(type),
			isDate: ['DATE', 'TIMESTAMP', 'TIME'].includes(type),
			isString: ['CHAR', 'VARCHAR', 'CLOB'].includes(type),
		};
	}
	return map;
}