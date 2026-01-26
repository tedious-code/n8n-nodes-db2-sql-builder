// export function buildGroupBy(cols: string[]): string {
// 	if (!cols.length) return '';
// 	return `GROUP BY ${cols.map(c => `"${c}"`).join(', ')}`;
// }

import { ColumnSchema } from "../type";

export function buildGroupBy(groupBy: {items: [ { mode: string, column?: string, expression?: string } ] }, schema: Record<string, ColumnSchema>) {
	if (!groupBy?.items?.length ) return '';
	
	console.log('Building Group By:', JSON.stringify(groupBy, null, 2));
	const parts = groupBy.items.map((g:any) => {
		if (g.mode === 'column') {
			console.log('Group By Column:', g.column);
			console.log('Schema:', JSON.stringify(schema, null, 2));
			console.log('Schema Column:', schema[g.column]);
			if (!schema[g.column].name ) {
				throw new Error(`Unknown GROUP BY column ${g.column}`);
			}
			return `${g.column}`;
		}

		if (g.mode === 'expression') {
			if (!g.expression?.trim()) {
				throw new Error(`Expression required for GROUP BY`);
			}
			return `${g.expression}`;
		}

		throw new Error(`Unsupported group by mode: ${g.mode}`);
	});

	return `GROUP BY ${parts.join(', ')}`;
}
