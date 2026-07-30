import { ColumnSchema } from '../type';
import { quoteIdent } from '../sqlSafety';

export function buildGroupBy(
	groupBy: {
		items?: Array<{ mode: string; column?: string; expression?: string }>;
	},
	schema: Record<string, ColumnSchema>,
) {
	if (!groupBy?.items?.length) return '';

	const parts = groupBy.items.map(g => {
		if (g.mode === 'column') {
			const key = g.column?.toUpperCase();
			const column = key ? schema[key] ?? schema[g.column!] : undefined;
			if (!column) {
				throw new Error(`Unknown GROUP BY column ${g.column}`);
			}
			return quoteIdent(column.name, 'column');
		}

		if (g.mode === 'expression') {
			if (!g.expression?.trim()) {
				throw new Error('Expression required for GROUP BY');
			}
			return g.expression;
		}

		throw new Error(`Unsupported group by mode: ${g.mode}`);
	});

	return `GROUP BY ${parts.join(', ')}`;
}
