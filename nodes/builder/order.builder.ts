// export function buildOrderBy(
// 	order: Array<{ field: string; direction: 'ASC' | 'DESC' }>,
// ): string {
// 	if (!order.length) return '';
// 	return `ORDER BY ${order
// 		.map(o => `"${o.field}" ${o.direction}`)
// 		.join(', ')}`;
// }

import { ColumnSchema } from "../type";

export function buildOrderBy(order: {fields: [ { mode: string, column?: string, expression?: string, direction: string } ] }, schema: Record<string, ColumnSchema>) {
	if (Object.keys(order).length === 0)  return '';

	const parts = order?.fields?.map((g:any) => {
		if (g.mode === 'column') {			
			if (!schema[g.column].name ) {
				throw new Error(`Unknown ORDER BY column ${g.column}`);
			}
			return `${g.column} ${g.direction}`;
		}

		if (g.mode === 'expression') {
			if (!g.expression?.trim()) {
				throw new Error(`Expression required for ORDER BY`);
			}
			return `${g.expression}`;
		}
		return ''
	});

	return `ORDER BY ${parts.join(', ')}`;
}
