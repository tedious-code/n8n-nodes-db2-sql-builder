import type { ICredentialDataDecryptedObject } from 'n8n-workflow';
import type { WhereGroup } from './type/where.condition';

/** DB2 ordinary identifier: letter/underscore start, then alnum/_/$/# */
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_$#]*$/;

/** Only these exact tokens may be inlined into INSERT VALUES (never user function calls). */
const SAFE_INSERT_LITERALS = new Set([
	'CURRENT_TIMESTAMP',
	'CURRENT TIMESTAMP',
	'CURRENT_DATE',
	'CURRENT DATE',
	'CURRENT_TIME',
	'CURRENT TIME',
]);

export function assertIdent(name: string, label = 'identifier'): string {
	const trimmed = String(name ?? '').trim();
	if (!trimmed) {
		throw new Error(`${label} is required`);
	}
	if (trimmed.includes('"') || trimmed.includes('.') || trimmed.includes(';')) {
		throw new Error(`Invalid ${label}: "${name}"`);
	}
	if (!IDENT_RE.test(trimmed)) {
		throw new Error(
			`Invalid ${label} "${name}". Use unquoted letters, digits, underscore, $, or # only.`,
		);
	}
	return trimmed;
}

export function quoteIdent(name: string, label = 'identifier'): string {
	const id = assertIdent(name, label);
	return `"${id.toUpperCase()}"`;
}

/** Quote an alias; allows spaces and most characters, escapes embedded quotes. */
export function quoteAlias(alias: string): string {
	const trimmed = String(alias ?? '').trim();
	if (!trimmed) {
		throw new Error('alias is required');
	}
	if (trimmed.includes(';') || trimmed.includes('--')) {
		throw new Error(`Invalid alias: "${alias}"`);
	}
	return `"${trimmed.replace(/"/g, '""')}"`;
}

export function resolveSchema(credentials: ICredentialDataDecryptedObject): string {
	const schema = String(credentials.schema ?? '').trim();
	return (schema || 'DB2INST1').toUpperCase();
}

export function qualifyTable(
	schema: string | undefined,
	table: string,
): string {
	const quotedTable = quoteIdent(table, 'table');
	const s = schema?.trim();
	if (!s) return quotedTable;
	return `${quoteIdent(s, 'schema')}.${quotedTable}`;
}

export function odbcEscape(value: unknown): string {
	const s = String(value ?? '');
	if (/[;{}=\n\r]/.test(s)) {
		return '{' + s.replace(/}/g, '}}') + '}';
	}
	return s;
}

export function buildConnectionString(c: ICredentialDataDecryptedObject): string {
	const protocol = c.useSsl || c.protocol === 'TCPIP_SSL' ? 'TCPIP_SSL' : 'TCPIP';
	return [
		'DRIVER={DB2}',
		`DATABASE=${odbcEscape(c.database)}`,
		`HOSTNAME=${odbcEscape(c.host)}`,
		`PORT=${odbcEscape(c.port)}`,
		`PROTOCOL=${protocol}`,
		`UID=${odbcEscape(c.username)}`,
		`PWD=${odbcEscape(c.password)}`,
	].join(';') + ';';
}

/** Pool cache key without password so credentials are not retained as Map keys. */
export function poolCacheKey(c: ICredentialDataDecryptedObject): string {
	const protocol = c.useSsl || c.protocol === 'TCPIP_SSL' ? 'TCPIP_SSL' : 'TCPIP';
	return [
		String(c.host ?? ''),
		String(c.port ?? ''),
		String(c.database ?? ''),
		String(c.username ?? ''),
		protocol,
		resolveSchema(c),
	].join('|');
}

export function normalizeSafeInsertLiteral(value: string): string | null {
	const t = value.trim().toUpperCase()
		.replace(/^NOW\(\)$/i, 'CURRENT_TIMESTAMP');
	if (SAFE_INSERT_LITERALS.has(t)) {
		return t.replace('CURRENT TIMESTAMP', 'CURRENT_TIMESTAMP')
			.replace('CURRENT DATE', 'CURRENT_DATE')
			.replace('CURRENT TIME', 'CURRENT_TIME');
	}
	return null;
}

export function assertSafeWhereGroups(
	groups: WhereGroup[] | undefined,
	allowUnsafeSql: boolean,
): void {
	if (allowUnsafeSql || !groups?.length) return;

	for (const group of groups) {
		for (const cond of group.conditions ?? []) {
			if (
				cond.mode === 'expression' ||
				cond.mode === 'exists' ||
				cond.mode === 'not_exists' ||
				cond.mode === 'subquery_in' ||
				cond.mode === 'subquery_not_in'
			) {
				throw new Error(
					'Raw SQL conditions (expression / EXISTS / subquery) require "Allow Unsafe SQL" to be enabled.',
				);
			}
		}
		if (group.groups?.length) {
			assertSafeWhereGroups(group.groups, allowUnsafeSql);
		}
	}
}

export function assertSafeSqlFragment(
	allowUnsafeSql: boolean,
	fragment: string | undefined,
	label: string,
): void {
	if (!fragment?.trim()) return;
	if (!allowUnsafeSql) {
		throw new Error(
			`${label} requires "Allow Unsafe SQL" to be enabled.`,
		);
	}
}
