import { ColumnSchema } from '../type';
import { quoteIdent } from '../sqlSafety';

export function buildHaving(
	having: any,
	schema: Record<string, ColumnSchema>,
) {
	if (!having?.fields?.length) return { sql: '', values: [] };

	const clauses: string[] = [];
	const values: any[] = [];

	for (const h of having.fields) {
		if (h.mode === 'aggregate') {
			if (h.fn === 'COUNT') {
				if (h.field === '*' || !h.field) {
					clauses.push(`COUNT(*) ${buildHavingOperator(h.operator)} ?`);
				} else {
					const key = String(h.field).toUpperCase();
					const col = schema[key] ?? schema[h.field];
					if (!col) throw new Error(`Unknown HAVING column "${h.field}"`);
					clauses.push(
						`COUNT(${quoteIdent(col.name, 'column')}) ${buildHavingOperator(h.operator)} ?`,
					);
				}
				const value = Number(h.value);
				if (Number.isNaN(value)) throw new Error('HAVING aggregate value must be numeric');
				values.push(value);
			} else {
				const key = String(h.field).toUpperCase();
				const col = schema[key] ?? schema[h.field];
				if (!col) throw new Error(`Unknown HAVING column "${h.field}"`);
				if (!col.isNumeric) {
					throw new Error(`HAVING ${h.fn} requires numeric column`);
				}
				clauses.push(
					`${h.fn}(DECIMAL(${quoteIdent(col.name, 'column')},18,2)) ${buildHavingOperator(h.operator)} ?`,
				);
				const value = Number(h.value);
				if (Number.isNaN(value)) throw new Error('HAVING aggregate value must be numeric');
				values.push(value);
			}
		} else {
			if (!h.expression || h.expression.trim() === '') {
				throw new Error('HAVING expression is required');
			}
			clauses.push(`(${h.expression})`);
		}
	}
	return {
		sql: `HAVING ${clauses.join(' AND ')}`,
		values,
	};
}

function buildHavingOperator(operator: string): string {
	switch (operator.toUpperCase()) {
		case 'GREATER':
			return '>';
		case 'LESS':
			return '<';
		case 'EQUAL':
			return '=';
		case 'NOT_EQUAL':
			return '<>';
		case 'GREATER_EQUAL':
			return '>=';
		case 'LESS_EQUAL':
			return '<=';
		default:
			throw new Error(`Unsupported HAVING operator: ${operator}`);
	}
}
