import { IExecuteFunctions, ICredentialDataDecryptedObject, INodeExecutionData, NodeOperationError } from "n8n-workflow";
import { createPool, getConnectionString, queryAsync, sanitizeSelectSQL, secureExecuteQuery } from "../GenericFunctions";

/* -------------------------------------------------------------------------- */
/*                                    Types                                   */
/* -------------------------------------------------------------------------- */

type BindingParam = {
	type: 'string' | 'number' | 'boolean' | 'date' | 'null' | 'sql';
	value?: string;
};

type QueryItem = {
	sql: string;
	binding?: {
		parameterValues?: BindingParam[];
	};
	transform?: string;
};

/* -------------------------------------------------------------------------- */
/*                               Utils                               */
/* -------------------------------------------------------------------------- */
function isSqlExpression(
	value: unknown,
): value is { __sql: string } {
	return (
		typeof value === 'object' &&
		value !== null &&
		'__sql' in value
	);
}

/* -------------------------------------------------------------------------- */
/*                               Binding helpers                               */
/* -------------------------------------------------------------------------- */
function buildSqlAndBindings(
	sql: string,
	params: BindingParam[],
): { sql: string; values: any[]; empty?: boolean } {

	let finalSql = sql;
	const values: any[] = [];
	const converted = params.map(convertBinding);

	let paramIndex = 0;

	/* ---------------- NAMED PARAMS :name ---------------- */
	const namedRegex = /:([a-zA-Z_][a-zA-Z0-9_]*)/g;
	const namedMap: Record<string, any> = {};

	finalSql = finalSql.replace(namedRegex, (_, name) => {
		if (!(name in namedMap)) {
			const v = converted[paramIndex++];
			namedMap[name] = v;
		}

		const val = namedMap[name];

		if (Array.isArray(val)) {
			if (!val.length) return '(NULL)';
			values.push(...val);
			return val.map(() => '?').join(',');
		}

		if (isSqlExpression(val)) {
			return val.__sql;
		}

		if (val == null) return 'NULL';

		values.push(val);
		return '?';
	});

	/* ---------------- IN (?) positional ---------------- */
	const inRegex = /\bIN\s*\(\s*\?\s*\)/gi;
	let match: RegExpExecArray | null;

	while ((match = inRegex.exec(finalSql)) !== null) {
		const v = converted[paramIndex++];

		if (!Array.isArray(v)) {
			throw new Error('IN (?) requires array parameter');
		}

		if (!v.length) return { sql: finalSql, values, empty: true };

		values.push(...v);
		finalSql =
			finalSql.slice(0, match.index) +
			`IN (${v.map(() => '?').join(',')})` +
			finalSql.slice(match.index + match[0].length);
	}

	/* ---------------- REMAINING ? ---------------- */
	for (; paramIndex < converted.length; paramIndex++) {
		const v = converted[paramIndex];

		if (isSqlExpression(v)) {
			finalSql = finalSql.replace('?', v.__sql);
		} else if (v == null) {
			return { sql: finalSql, values, empty: true };
		} else {
			values.push(v);
		}
	}

	validate(finalSql, values);
	return { sql: finalSql, values };
}

/* ------------------------------------------------------------------ */
/*                          Final validation                           */
/* ------------------------------------------------------------------ */

function validate(sql: string, values: any[]) {
	const expected = (sql.match(/\?/g) || []).length;
	if (expected !== values.length) {
		throw new Error(
			[
				'❌ SQL parameter mismatch',
				`Expected ?: ${expected}`,
				`Provided: ${values.length}`,
				`SQL: ${sql}`,
			].join('\n'),
		);
	}
}



function normalizeScalar(type: BindingParam['type'], value: any) {
	switch (type) {
		case 'number': return Number(value);
		case 'boolean': return value === true || value === 'true' || value === '1' || value === 1;
		case 'date': return value instanceof Date ? value : new Date(value);
		case 'null': return null;
		case 'sql': return { __sql: value };
		default: return String(value ?? '');
	}
}

function normalizeBindingFromUI(
	raw: { parameterValues?: BindingParam[] } | undefined,
	context: Record<string, any>,
): BindingParam[] {
	if (!raw?.parameterValues?.length) return [];

	return raw.parameterValues.map(p => ({
		type: p.type,
		value:
			typeof p.value === 'string'
				? interpolate(p.value, context)
				: p.value,
	}));
}

// 'string ?'
// "identifier ?"
// -- comment ?
// /* comment ? */
function countSqlPlaceholders(sql: string): number {
	let count = 0;
	let inSingle = false;
	let inDouble = false;
	let inLineComment = false;
	let inBlockComment = false;

	for (let i = 0; i < sql.length; i++) {
		const c = sql[i];
		const next = sql[i + 1];

		// -- line comment
		if (!inSingle && !inDouble && !inBlockComment && c === '-' && next === '-') {
			inLineComment = true;
			i++;
			continue;
		}

		if (inLineComment && c === '\n') {
			inLineComment = false;
			continue;
		}

		// /* block comment */
		if (!inSingle && !inDouble && !inLineComment && c === '/' && next === '*') {
			inBlockComment = true;
			i++;
			continue;
		}

		if (inBlockComment && c === '*' && next === '/') {
			inBlockComment = false;
			i++;
			continue;
		}

		if (inLineComment || inBlockComment) continue;

		// single quote '
		if (c === "'" && !inDouble && sql[i - 1] !== '\\') {
			inSingle = !inSingle;
			continue;
		}

		// double quote "
		if (c === '"' && !inSingle && sql[i - 1] !== '\\') {
			inDouble = !inDouble;
			continue;
		}

		// placeholder
		if (c === '?' && !inSingle && !inDouble) {
			count++;
		}
	}

	return count;
}


/* -------------------------------------------------------------------------- */
/*                              Main Execute Logic                             */
/* -------------------------------------------------------------------------- */
export async function executeQueryAsync(
	ctx: IExecuteFunctions,
	credential: ICredentialDataDecryptedObject,
): Promise<INodeExecutionData[]> {

	const queries = ctx.getNodeParameter('queries', 0) as {
		query: QueryItem[];
	};
	const limit  = (ctx.getNodeParameter('limitSelect', 0, 200) as number) ?? 200;
	const previewSQL = ctx.getNodeParameter('previewSQL', 0) as boolean;
	const returnMode = ctx.getNodeParameter('returnMode', 0) as string;
	const stopOnError = ctx.getNodeParameter('stopOnError', 0) as boolean;
	const inTransaction = ctx.getNodeParameter('useTransaction', 0) as boolean;


	const context: Record<string, any> = {};
	const allOutputs: INodeExecutionData[] = [];

	const conn = await createPool(credential);

	try {
		if (inTransaction && !previewSQL) {
			await conn.beginTransaction();
		}

		for (let i = 0; i < queries.query.length; i++) {
			const q = queries.query[i];
			const outputName = `output${i}`;

			const params = normalizeBindingFromUI(q.binding, context);
			let { sql, values, empty} = buildSqlAndBindings(
				q.sql,
				params,
			);

			// PREVIEW QUERIES
			if (previewSQL) {				
				allOutputs.push({
					json: {
						[outputName]: {
							sql,
							placeholders: countSqlPlaceholders(sql), // COUNT ? and parameters
							parameters: values.map((v, i) => ({
								index: i + 1,
								value: v,
							})),
							valid: true,
						},
					},
				});
				continue;
			}

			if (empty) {
				context[outputName] = [];
				allOutputs.push({ json: { [outputName]: [] } });
				continue;
			}
			// EXECUTE QUERY
			let raw;

			const onlySelect  = (ctx.getNodeParameter('onlySelect', 0, false) as boolean) ?? false;

			if(onlySelect) {
				throw new NodeOperationError(
					ctx.getNode(),
					'Only SELECT is allowed.',
				);
			}

			try {
				sql = sanitizeSelectSQL(sql, limit, onlySelect);
				raw = await secureExecuteQuery(
						queryAsync,
						getConnectionString(credential),
						sql,
						values,
						{
							strict: false,
						},
						limit
					);
			} catch (e) {
					throw new Error(
						[
							'❌ SQL Execution Error',
							(e as Error).message,
							'---',
							`SQL: ${sql}`,
							`Bindings: ${JSON.stringify(values)}`,
						].join('\n'),
					);
			}
		
			const result = q.transform?.trim() 
				? await new Function(
						'result',
						'context',
						'helpers',
						'_',
						'moment',
						`
							"use strict";
							return (async () => {
								${q.transform}
							})();
						`,
				  )(raw, context, ctx.helpers ,require('lodash'), require('moment'))
				: raw;

			context[outputName] = result;
			allOutputs.push({ json: { [outputName]: result } });
		}

		if (inTransaction && !previewSQL) {
			await conn.commitTransaction();
		}

	} catch (e) {
		if (inTransaction && !previewSQL) {
			await conn.rollbackTransaction();
		}

		allOutputs.push({
			json: {
				error: (e as Error).message,
				contextSnapshot: context,
			},
		});

		if (stopOnError) return allOutputs;
	}
	
	if (previewSQL) return allOutputs;

	switch (returnMode) {
		case 'last':
			return allOutputs.length
				? [allOutputs[allOutputs.length - 1]]
				: [];
		case 'specific':
			const returnOutputIndex = ctx.getNodeParameter('returnOutput', 0) as number;
			return allOutputs[returnOutputIndex]
				? [allOutputs[returnOutputIndex]]
				: [];
		case 'merge': {
			const merged: Record<string, any> = {};
			for (const item of allOutputs) {
				Object.assign(merged, item.json);
			}

			return [{ json: merged }];
		}

		case 'all':
		default:
			return allOutputs;
	}
}


// DECODE ARRAY 
function interpolate(str: string, ctxObj: Record<string, any>) {
	return str.replace(/\$\{([^}]+)\}/g, (_, key) => {
		const value = key.split('.').reduce((acc: any, part: string) =>
			acc ? acc[part] : undefined,
			ctxObj
		);
		if (Array.isArray(value)) return '__ARRAY__:' + JSON.stringify(value);

		return value ?? '';
	});
}

function convertBinding(param: BindingParam): any {

	const raw = param.value;

	/* -------------------------------------------------- */
	/* CASE 1: ${output0.COL1} binding from previous result is array*/
	/* -------------------------------------------------- */
	if (typeof raw === 'string' && raw.startsWith('__ARRAY__:')) {
		const arr = JSON.parse(raw.replace('__ARRAY__:', ''));
		if (!Array.isArray(arr)) {
			throw new Error('Invalid array binding');
		}
		return arr.map(v => normalizeScalar(param.type, v));
	}

	/* -------------------------------------------------- */
	/* CASE 2: [${output0.COL1}] | [${output0.COL1},6]     */
	/* User type array values in textbox value  */
	/* -------------------------------------------------- */
	if (
		typeof raw === 'string' &&
		raw.trim().startsWith('[') &&
		raw.includes('__ARRAY__:')
	) {
		const inner = raw
			.trim()
			.slice(1, -1) // remove [ ]
			.split(',')
			.map(v => v.trim())
			.flatMap(v => {
				if (v.startsWith('__ARRAY__:')) {
					const arr = JSON.parse(v.replace('__ARRAY__:', ''));
					if (!Array.isArray(arr)) {
						throw new Error('Invalid wrapped array binding');
					}
					return arr;
				}
				return [v];
			});

		return inner.map(v => normalizeScalar(param.type, v));
	}

	/* -------------------------------------------------- */
	/* SCALAR ONLY                                        */
	/* -------------------------------------------------- */
	return normalizeScalar(param.type, raw);
}
