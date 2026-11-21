/**
 * Slim CJS entry for the n8n bundle. Do not re-export @foxschema/db's full index:
 * that pulls in all of @foxschema/sql and bloats the pack.
 *
 * `#foxschema-db2` is @foxschema/db-db2 when foxSchema ships Db2 as an add-on,
 * or a no-op stub when Db2 is still built into @foxschema/db.
 */
export { ConnectionFactory } from '#foxschema-factory';
export { getAdapter } from '#foxschema-adapters';
export { getRegisteredProvider } from '#foxschema-providers';
export { registerDb2 } from '#foxschema-db2';
