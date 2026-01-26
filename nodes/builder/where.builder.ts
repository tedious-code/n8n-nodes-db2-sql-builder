import { WhereCondition, WhereGroup } from "../type/where.condition";
import { ColumnSchema } from "../type";

export function buildWhereClause(
	input?: WhereGroup | WhereGroup[],
	schema?: Record<string, ColumnSchema>,
): { sql: string; values: any[] } {
	console.log('Building Where Clause from Input:', JSON.stringify(input, null, 2));
	if (!input) return { sql: '', values: [] };

	const groups = Array.isArray(input) ? input : [input];
	const parts: string[] = [];
	const values: any[] = [];
	let firstGroup = true;
	for (const group of groups) {
		
		if(firstGroup){			
			// We don't need AND/OR before the 1st group because WHERE is already there
			firstGroup = false;			
		}
		else {
			parts.push(` ${group?.filterType ?? 'AND'}`);
		}
		if (!group || (!group.conditions?.length && !group.groups?.length)) continue;

		const segParts: string[] = [];
		const segValues: any[] = [];
		// Flat column conditions only
		for (const cond of group.conditions ?? []) {
			const res = buildCondition(cond, schema!);
			if (!res.sql) continue;
			segParts.push(res.sql);
			segValues.push(...res.values);
		}

		if (segParts.length) {
			parts.push(`(${segParts.join(` ${group.filterType} `)})`);
			values.push(...segValues);
		}	
	}

	if (!parts.length) return { sql: '', values: [] };
	return {
		sql: `WHERE ${parts.join(` `)}`,
		values,
	};
}

export function castValue(
	col: ColumnSchema,
	value: any,
) {
	if (value === null || value === undefined) {
		return null;
	}

	// Normalize string
	if (typeof value === 'string') {
		let v = value.trim();
		// Strip wrapping single/double quotes
		if (
			(v.startsWith("'") && v.endsWith("'")) ||
			(v.startsWith('"') && v.endsWith('"'))
		) {
			v = v.slice(1, -1);
		}
		value = v;
	}

	// Numeric
	if (col.isNumeric) {
		const num = Number(value);
		if (Number.isNaN(num)) {
			throw new Error(
				`Column "${col.name}" expects NUMBER, got "${value}"`,
			);
		}
		return num;
	}

	// Date (assume YYYY-MM-DD or ISO)
	if (col.isDate) {
		if (typeof value !== 'string') {
			throw new Error(
				`Column "${col.name}" expects DATE string`,
			);
		}
		return value;
	}
	return String(value);
}


export  function buildCondition(
	cond: WhereCondition,
	schema: Record<string, ColumnSchema>,
): { sql: string; values: any[] } {
	switch(cond.mode) {
		case 'column':
			switch (cond.operator.toUpperCase()) {
				case 'EQUAL':
				case 'NOT_EQUAL':
				case 'GREATER':
				case 'LESS':
				case 'GREATER_EQUAL':
				case 'LESS_EQUAL':
					if(cond.column == '*'){
						return { sql: '', values: [] };
					}
					return {
						sql: `"${schema[cond.column].name}" ${operatorTranslate(cond.operator)} ?`,
						values: [castValue(schema[cond.column], cond.value)],
					};
				case 'LIKE':
					if (!schema[cond.column].isString) {
						throw new Error(
							`LIKE only allowed on string column`,
						);
					}
					if(cond.column == '*'){
						return { sql: '', values: [] };
					}
					return {
						sql: `"${schema[cond.column].name}" LIKE ?`,
						values: [`${cond.value}`],
					};
				
				case 'CONTAINS':
					if (!schema[cond.column].isString) {
						throw new Error(
							`LIKE only allowed on string column`,
						);
					}
					if(cond.column == '*'){
						return { sql: '', values: [] };
					}
					return {
						sql: `"${schema[cond.column].name}" LIKE ?`,
						values: [`%${cond.value}%`],
					};				
				
				case 'NOT BETWEEN':
					if (!cond.values || cond.values.length !== 2) {
						throw new Error(
							`BETWEEN requires exactly 2 values`,
						);
					}
					if(cond.column == '*'){
						return { sql: '', values: [] };
					}
					return {
						sql: `"${schema[cond.column].name}" NOT BETWEEN ? AND ?`,
						values: [
							castValue(schema[cond.column], cond.values[0]),
							castValue(schema[cond.column], cond.values[1]),
						],
					};
				default:
					throw new Error(
						`Unsupported operator "${cond.operator}"`,
					);
			}			
		case 'exists':
			if(cond.sql == '*'){
				return { sql: '', values: [] };
			}
			return {
				sql: ` EXISTS (${cond.sql})`,
				values: [],
			};
		case 'not_exists':
			if(cond.sql == '*'){
				return { sql: '', values: [] };
			}
			return {
				sql: ` NOT EXISTS (${cond.sql})`,
				values: [],
			};
		case 'column_in':			
			if (!cond.values?.length) {
				throw new Error(`IN requires values`);
			}
			if(cond.column == '*'){
				return { sql: '', values: [] };
			}
			return {
				sql: `"${schema[cond.column].name}" IN (${cond.values
					.map(() => '?')
					.join(', ')})`,
				values: cond.values.map(v =>
					castValue(schema[cond.column], v),
				),
			};
		case 'column_not_in':
			if (!cond.values?.length) {
				throw new Error(`IN requires values`);
			}
			if(cond.column == '*'){
				return { sql: '', values: [] };
			}
			return {
				sql: `"${schema[cond.column].name}" NOT IN (${cond.values
					.map(() => '?')
					.join(', ')})`,
				values: cond.values.map(v =>
					castValue(schema[cond.column], v),
				),
			};
		case 'between':			
			if (!cond.values || cond.values.length < 2) {
				throw new Error(
					`BETWEEN requires exactly 2 values`,
				);
			}
			if(cond.column == '*'){
				return { sql: '', values: [] };
			}
			return {
				sql: `"${schema[cond.column].name}" BETWEEN ? AND ?`,
				values: [
					castValue(schema[cond.column], cond.values[0]),
					castValue(schema[cond.column], cond.values[1]),
				],
			};
		case 'not_between':
			if (!cond.values || cond.values.length < 2) {
				throw new Error(
					`NOT BETWEEN requires exactly 2 values`,
				);
			}
			if(cond.column == '*'){
				return { sql: '', values: [] };
			}
			return {
				sql: `"${schema[cond.column].name}" NOT BETWEEN ? AND ?`,
				values: [
					castValue(schema[cond.column], cond.values[0]),
					castValue(schema[cond.column], cond.values[1]),
				],
			};
		case 'expression':
			if(cond.sql == '*'){
				return { sql: '', values: [] };
			}
			return {
				sql: ` ${cond.sql} `,
				values: [],
			};
		default:
			throw new Error(
				`Unsupported operator`,
			);				
	}
}

export function normalizeUiWhere(additionalConditions: any): WhereGroup[] {
	const result: WhereGroup[] = [];
	// console.log('Normalizing UI Where Conditions:', JSON.stringify(additionalConditions, null, 2));
	if (!additionalConditions?.groups?.length) return result;
	// console.log('Processing Groups:', additionalConditions.groups.length);
	// console.log('Additional Conditions:', JSON.stringify(additionalConditions, null, 2));
	for (const g of additionalConditions.groups) {
		const fields = g.filters?.fields ?? [];
		const conditions: WhereCondition[] = [];

		for (const f of fields) {
			switch (f.mode) {

				case 'column':
					conditions.push({
						mode: 'column',
						column: f.field,
						operator: f.operator,
						value: f.value,
						values: f.values ? f.values.split(',').map((v: string) => v.trim()) : undefined,
					});
					break;
				case 'column_in':
				case 'column_not_in':
				case 'between':
				case 'not_between':
					conditions.push({
						mode: f.mode,
						column: f.field,
						operator: f.operator,
						value: f.value,
						values: f.values ? f.values.split(',').map((v: string) => v.trim()) : undefined,
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
			filterType: g.filterType ?? 'OR',
			conditions,
		});
	}
	// console.log('Normalized Where Groups:', JSON.stringify(result, null, 2));
	return result;
}

function operatorTranslate(operator:string){
	switch(operator.toUpperCase()){
		case  'EQUAL':
			return '=';
		case 'NOT_EQUAL':
			return '!=';
		case 'GREATER':
			return '>';
		case 'LESS':
			return '<';
		case 'GREATER_EQUAL':
			return '>=';
		case 'LESS_EQUAL':
			return '<=';
	}
	return operator;
}