import type { FoxRoutineParameter, FoxTableSchema } from './foxSchema';
import { qualifyTable, quoteIdent } from './sqlSafety';

const CALL_PARAM_MODES = new Set(['IN', 'OUT', 'INOUT']);

export type RoutineParameterMode = 'form' | 'fromItem' | 'json';

export function isCallParamMode(mode: string | undefined): boolean {
	const m = String(mode ?? 'IN').toUpperCase();
	return CALL_PARAM_MODES.has(m);
}

export function normalizeParamKey(name: string): string {
	return String(name ?? '')
		.trim()
		.replace(/^@/, '')
		.toUpperCase();
}

export function lookupParamValue(
	valueByName: Record<string, unknown>,
	paramName: string,
): { found: boolean; value: unknown } {
	const target = normalizeParamKey(paramName);
	if (!target) return { found: false, value: undefined };
	const key = Object.keys(valueByName).find(k => normalizeParamKey(k) === target);
	if (key === undefined) return { found: false, value: undefined };
	return { found: true, value: valueByName[key] };
}

/** Skip RETURN / RESULT catalog metadata when building CALL / SELECT args. */
export function filterCallParameters(
	params: FoxRoutineParameter[] | undefined,
	objectType?: 'PROCEDURE' | 'FUNCTION',
): FoxRoutineParameter[] {
	const sorted = (params ?? [])
		.filter(p => isCallParamMode(p.mode))
		.slice()
		.sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));

	if (objectType === 'FUNCTION') {
		return sorted.filter(p => {
			const mode = String(p.mode ?? 'IN').toUpperCase();
			return mode === 'IN' || mode === 'INOUT';
		});
	}

	return sorted;
}

/** IN / INOUT only — what callers bind in the Form UI. */
export function filterBindParameters(
	params: FoxRoutineParameter[] | undefined,
	objectType?: 'PROCEDURE' | 'FUNCTION',
): FoxRoutineParameter[] {
	return filterCallParameters(params, objectType).filter(p => {
		const mode = String(p.mode ?? 'IN').toUpperCase();
		return mode === 'IN' || mode === 'INOUT';
	});
}

export function resolveRoutineName(routineId: unknown): string {
	const raw =
		typeof routineId === 'object' && routineId && 'value' in (routineId as object)
			? String((routineId as { value?: unknown }).value ?? '')
			: String(routineId ?? '');
	const trimmed = raw.trim();
	if (!trimmed) {
		throw new Error('Procedure / function name is required');
	}
	return trimmed;
}

export function findRoutine(
	objects: FoxTableSchema[],
	name: string,
	expectedType?: 'PROCEDURE' | 'FUNCTION',
): FoxTableSchema {
	const target = name.toUpperCase();
	const obj = objects.find(o => {
		if (o.name.toUpperCase() !== target) return false;
		if (expectedType) return o.objectType === expectedType;
		return o.objectType === 'PROCEDURE' || o.objectType === 'FUNCTION';
	});
	if (!obj) {
		const kind = expectedType ?? 'procedure/function';
		throw new Error(`${kind} "${name}" not found in FoxSchema catalog`);
	}
	return obj;
}

export function castRoutineValue(
	raw: unknown,
	param: FoxRoutineParameter,
): unknown {
	if (raw === undefined || raw === null || raw === '') {
		return null;
	}

	const type = String(param.type ?? '').toUpperCase();
	if (/INT|DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL|NUMBER|MONEY|SERIAL|BIGINT|SMALLINT/.test(type)) {
		const n = Number(raw);
		if (Number.isNaN(n)) {
			throw new Error(`Parameter "${param.name}" expects a number, got "${raw}"`);
		}
		return n;
	}

	if (/BOOL|BIT/.test(type)) {
		if (typeof raw === 'boolean') return raw;
		const s = String(raw).trim().toLowerCase();
		if (['1', 'true', 'yes', 'y'].includes(s)) return true;
		if (['0', 'false', 'no', 'n'].includes(s)) return false;
		throw new Error(`Parameter "${param.name}" expects a boolean, got "${raw}"`);
	}

	return raw;
}

function rowsToValueMap(
	rows: Array<{ name?: string; value?: unknown }> | undefined,
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const row of rows ?? []) {
		const name = String(row.name ?? '').trim();
		if (!name) continue;
		out[name] = row.value;
	}
	return out;
}

export function parseParametersJson(raw: unknown): Record<string, unknown> {
	if (raw === undefined || raw === null || raw === '') return {};
	if (typeof raw === 'object' && !Array.isArray(raw)) {
		return { ...(raw as Record<string, unknown>) };
	}
	if (typeof raw === 'string') {
		const trimmed = raw.trim();
		if (!trimmed) return {};
		const parsed = JSON.parse(trimmed) as unknown;
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
			throw new Error('Parameters JSON must be an object');
		}
		return { ...(parsed as Record<string, unknown>) };
	}
	throw new Error('Parameters JSON must be an object');
}

export function resolveRoutineParameterValues(options: {
	mode: RoutineParameterMode;
	routine: FoxTableSchema;
	formValues?: Array<{ name?: string; value?: unknown }>;
	overrides?: Array<{ name?: string; value?: unknown }>;
	itemJson?: Record<string, unknown>;
	parametersJson?: unknown;
	strictParamMapping?: boolean;
}): Record<string, unknown> {
	const objectType = options.routine.objectType as 'PROCEDURE' | 'FUNCTION';
	const bindParams = filterBindParameters(options.routine.parameters, objectType);
	const mode = options.mode;

	if (mode === 'form') {
		const provided = rowsToValueMap(options.formValues);
		const missing = bindParams.filter(
			p => p.name && !lookupParamValue(provided, p.name).found,
		);
		if (missing.length) {
			throw new Error(
				`Missing IN/INOUT parameter value(s): ${missing.map(p => p.name).join(', ')}`,
			);
		}
		return provided;
	}

	if (mode === 'json') {
		try {
			return parseParametersJson(options.parametersJson);
		} catch (e) {
			if (e instanceof SyntaxError) {
				throw new Error(`Invalid Parameters JSON: ${e.message}`);
			}
			throw e;
		}
	}

	const overrides = rowsToValueMap(options.overrides);
	const item = options.itemJson ?? {};
	const out: Record<string, unknown> = {};
	const strict = options.strictParamMapping !== false;

	for (const p of bindParams) {
		if (!p.name) continue;
		const over = lookupParamValue(overrides, p.name);
		if (over.found) {
			out[p.name] = over.value;
			continue;
		}
		const fromItem = lookupParamValue(item, p.name);
		if (fromItem.found) {
			out[p.name] = fromItem.value;
			continue;
		}
		if (strict) {
			throw new Error(
				`Missing parameter "${p.name}" on incoming item (and no override). Disable Strict Mapping to bind null.`,
			);
		}
		out[p.name] = null;
	}

	return out;
}

export interface BuiltRoutineCall {
	sql: string;
	params: unknown[];
	objectType: 'PROCEDURE' | 'FUNCTION';
	routineName: string;
}

/**
 * Build Db2 CALL / SELECT for a catalog routine.
 * IN/INOUT values are bound positionally; OUT placeholders receive null.
 */
export function buildRoutineCallSql(
	schema: string,
	routine: FoxTableSchema,
	valueByName: Record<string, unknown>,
): BuiltRoutineCall {
	const objectType = routine.objectType as 'PROCEDURE' | 'FUNCTION';
	if (objectType !== 'PROCEDURE' && objectType !== 'FUNCTION') {
		throw new Error(`Object "${routine.name}" is not a procedure or function`);
	}

	const callParams = filterCallParameters(routine.parameters, objectType);
	const params: unknown[] = [];

	for (const p of callParams) {
		const mode = String(p.mode ?? 'IN').toUpperCase();
		const looked = lookupParamValue(valueByName, p.name);
		const raw = looked.found ? looked.value : undefined;
		if (mode === 'OUT' && (raw === undefined || raw === '')) {
			params.push(null);
			continue;
		}
		params.push(castRoutineValue(raw, p));
	}

	const qualified = qualifyTable(schema, routine.name);
	const placeholders = callParams.map(() => '?').join(', ');
	const argList = placeholders ? `(${placeholders})` : '()';

	const sql =
		objectType === 'FUNCTION'
			? `SELECT ${qualified}${argList} AS ${quoteIdent('result', 'alias')} FROM SYSIBM.SYSDUMMY1`
			: `CALL ${qualified}${argList}`;

	return {
		sql,
		params,
		objectType,
		routineName: routine.name,
	};
}
