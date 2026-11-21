import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConnectionFactory, getAdapter, getRegisteredProvider } from '../nodes/foxSchema';

describe('bundled foxschema', () => {
	it('registers Db2 at load', () => {
		const adapter = getAdapter('db2');
		assert.equal(adapter.packageName, 'ibm_db');
		assert.equal(typeof adapter.query, 'function');
		assert.equal(typeof getRegisteredProvider('db2').testConnection, 'function');
		assert.equal(typeof ConnectionFactory.create, 'function');
	});
});
