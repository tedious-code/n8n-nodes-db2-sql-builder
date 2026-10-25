/**
 * Slim CJS entry for the n8n bundle. Do not re-export @foxschema/db's full index —
 * that pulls in all of @foxschema/sql and bloats the pack.
 */
export { ConnectionFactory } from '#foxschema-factory';
export { getAdapter } from '#foxschema-adapters';
export { getRegisteredProvider } from '#foxschema-providers';
