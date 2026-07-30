import { ColumnSchema } from '../type';
import { quoteIdent } from '../sqlSafety';

export function buildOrderBy(
	order:
		| {
				fields?: Array<{
					mode: string;
					column?: string;
					expression?: string;
					direction?: string;
				}>;
		  }
		| null
		| undefined,
	schema: Record<string, ColumnSchema>,
) {
	if (!order?.fields?.length) return '';

	const parts = order.fields.map(g => {
		const direction = g.direction?.toUpperCase() ?? 'ASC';
		if (direction !== 'ASC' && direction !== 'DESC') {
			throw new Error(`Unsupported ORDER BY direction: ${g.direction}`);
		}
		if (g.mode === 'column') {
			const key = g.column?.toUpperCase();
			const column = key ? schema[key] ?? schema[g.column!] : undefined;
			if (!column) {
				throw new Error(`Unknown ORDER BY column ${g.column}`);
			}
			return `${quoteIdent(column.name, 'column')} ${direction}`;
		}

		if (g.mode === 'expression') {
			if (!g.expression?.trim()) {
				throw new Error('Expression required for ORDER BY');
			}
			return `${g.expression} ${direction}`;
		}
		throw new Error(`Unsupported ORDER BY mode: ${g.mode}`);
	});

	return `ORDER BY ${parts.join(', ')}`;
}
