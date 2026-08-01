import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	assertIdent,
	assertSafeWhereGroups,
	buildConnectionString,
	normalizeSafeInsertLiteral,
	odbcEscape,
	poolCacheKey,
	qualifyTable,
	quoteAlias,
	quoteIdent,
	resolveSchema,
	toConnectionOptions,
} from '../nodes/sqlSafety';
import { buildWhereClause, normalizeUiWhere } from '../nodes/builder/where.builder';
import { buildSelectClause, buildSchemaMap } from '../nodes/builder/select.builder';
import { buildLimit } from '../nodes/builder/limit.builder';
import type { ColumnSchema } from '../nodes/type';

const schema: Record<string, ColumnSchema> = {
	ID: { name: 'ID', type: 'INTEGER', isNumeric: true, isDate: false, isString: false },
	NAME: { name: 'NAME', type: 'VARCHAR', isNumeric: false, isDate: false, isString: true },
};

describe('sqlSafety', () => {
	it('rejects unsafe identifiers', () => {
		assert.throws(() => assertIdent('users;drop'), /Invalid/);
		assert.throws(() => assertIdent('a.b'), /Invalid/);
		assert.throws(() => assertIdent('"x"'), /Invalid/);
	});

	it('quotes identifiers and qualifies tables', () => {
		assert.equal(quoteIdent('users'), '"USERS"');
		assert.equal(qualifyTable('MYSCHEMA', 'users'), '"MYSCHEMA"."USERS"');
		assert.equal(quoteAlias('Total Count'), '"Total Count"');
	});

	it('escapes ODBC special characters', () => {
		assert.equal(odbcEscape('p;ass'), '{p;ass}');
	});

	it('maps credentials to foxSchema ConnectionOptions and omits password from pool key', () => {
		const creds = {
			host: 'h',
			port: 50000,
			database: 'db',
			username: 'u',
			password: 'secret',
			schema: 'S1',
			protocol: 'TCPIP',
		};
		const conn = buildConnectionString(creds);
		assert.match(conn, /PWD=secret/);
		assert.equal(poolCacheKey(creds).includes('secret'), false);
		assert.equal(resolveSchema({ schema: '' }), 'DB2INST1');

		const opts = toConnectionOptions(creds);
		assert.equal(opts.host, 'h');
		assert.equal(opts.port, 50000);
		assert.equal(opts.database, 'db');
		assert.equal(opts.username, 'u');
		assert.equal(opts.password, 'secret');
		assert.equal(opts.schema, 'S1');
		assert.equal((opts.ssl as { enabled: boolean }).enabled, false);

		const sslOpts = toConnectionOptions({ ...creds, useSsl: true });
		assert.equal((sslOpts.ssl as { enabled: boolean }).enabled, true);

		const protoSsl = toConnectionOptions({ ...creds, protocol: 'TCPIP_SSL' });
		assert.equal((protoSsl.ssl as { enabled: boolean }).enabled, true);
	});

	it('only allows safe insert literals', () => {
		assert.equal(normalizeSafeInsertLiteral('CURRENT_TIMESTAMP'), 'CURRENT_TIMESTAMP');
		assert.equal(normalizeSafeInsertLiteral('NOW()'), 'CURRENT_TIMESTAMP');
		assert.equal(normalizeSafeInsertLiteral('UPPER(x)'), null);
	});

	it('gates unsafe where groups', () => {
		assert.throws(
			() =>
				assertSafeWhereGroups(
					[{ filterType: 'AND', conditions: [{ mode: 'expression', sql: '1=1' }] }],
					false,
				),
			/Allow Unsafe SQL/,
		);
		assert.doesNotThrow(() =>
			assertSafeWhereGroups(
				[{ filterType: 'AND', conditions: [{ mode: 'expression', sql: '1=1' }] }],
				true,
			),
		);
	});
});

describe('where.builder', () => {
	it('defaults group filter to AND and binds values', () => {
		const groups = normalizeUiWhere({
			groups: [
				{
					filters: {
						fields: [
							{ mode: 'column', field: 'id', operator: 'equal', value: '1' },
							{ mode: 'column', field: 'name', operator: 'contains', value: 'ab' },
						],
					},
				},
			],
		});
		assert.equal(groups[0].filterType, 'AND');
		const built = buildWhereClause(groups, schema);
		assert.equal(built.sql, 'WHERE ("ID" = ? AND "NAME" LIKE ?)');
		assert.deepEqual(built.values, [1, '%ab%']);
	});

	it('builds IN and BETWEEN with cast values', () => {
		const built = buildWhereClause(
			[
				{
					filterType: 'AND',
					conditions: [
						{ mode: 'column_in', column: 'ID', values: ['1', '2'] },
						{ mode: 'between', column: 'ID', values: ['1', '10'] },
					],
				},
			],
			schema,
		);
		assert.match(built.sql, /IN \(\?, \?\)/);
		assert.match(built.sql, /BETWEEN \? AND \?/);
		assert.deepEqual(built.values, [1, 2, 1, 10]);
	});
});

describe('select.builder + limit', () => {
	it('maps schema and builds select clause', () => {
		const map = buildSchemaMap([
			{ COLNAME: 'id', TYPENAME: 'INTEGER' },
			{ COLNAME: 'name', TYPENAME: 'VARCHAR' },
		]);
		assert.ok(map.ID?.isNumeric);
		const sql = buildSelectClause(
			[{ mode: 'column', columnSelect: { column: 'name', alias: 'label' } }],
			map,
		);
		assert.equal(sql, '"NAME" AS "label"');
	});

	it('validates limit', () => {
		assert.equal(buildLimit(10), 'FETCH FIRST 10 ROWS ONLY');
		assert.throws(() => buildLimit(0), /positive/);
		assert.throws(() => buildLimit(100001), /100000/);
	});
});
