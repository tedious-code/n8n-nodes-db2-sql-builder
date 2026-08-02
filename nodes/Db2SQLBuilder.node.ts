import {
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	NodeConnectionTypes,
	ICredentialsDecrypted,
	ICredentialTestFunctions,
	INodeCredentialTestResult,
	ICredentialDataDecryptedObject,
	NodeOperationError,
} from 'n8n-workflow';

import {
	testConnection,
	resolveTable,
	createItems,
	updateItems,
	getItems,
	deleteItems,
	callRoutineItems,
} from './GenericFunctions';
import { operationFields } from './OperationDescription';
import {
	getColumns,
	getParameters,
	searchDbObjects,
	searchFunctions,
	searchProcedures,
	searchRoutines,
	searchTables,
} from './schemaCache';
import { executeQueryAsync } from './executeSQL/ExecuteQuery';

export class Db2SQLBuilder implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Db2SqlBuilder',
		name: 'db2sqlbuilder',
		icon: 'file:IbmDb2.svg',
		group: ['output'],
		version: 1,
		description:
			'SQL Builder powered by FoxSchema core. Supports all FoxSchema dialects (PostgreSQL, MySQL/MariaDB, SQL Server, Oracle, Db2). This Docker image runs Db2 via ibm_db.',
		subtitle: '={{$parameter["resource"] + ($parameter["operation"] ? (":" + $parameter["operation"]) : "")}}',
		defaults: {
			name: 'Db2SqlBuilder',
		},
		codex: {
			categories: ['Data & Storage', 'Development'],
			alias: [
				'sql',
				'database',
				'db2',
				'foxschema',
				'postgres',
				'mysql',
				'oracle',
				'mssql',
				'mariadb',
			],
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'IbmDb2OdbcCredentialsApi',
				required: true,
				testedBy: 'dbConnectionTest',
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Row',
						value: 'row',
					},
					{
						name: 'Routine',
						value: 'routine',
					},
					{
						name: 'Execute Query',
						value: 'executeSQL',
					},
				],
				default: 'row',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['row'],
					},
				},
				options: [
					{
						name: 'Get',
						value: 'get',
						description: 'Fetch data from a table',
						action: 'Get a row',
					},
					{
						name: 'Create',
						value: 'create',
						description: 'Create a row for one table',
						action: 'Create a row',
					},
					{
						name: 'Delete',
						value: 'delete',
						description: 'Delete a row for one table',
						action: 'Delete a row',
					},
					{
						name: 'Update',
						value: 'update',
						description: 'Update a row for one table',
						action: 'Update a row',
					},
				],
				default: 'get',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['routine'],
					},
				},
				options: [
					{
						name: 'Call Procedure',
						value: 'callProcedure',
						description: 'Execute a stored procedure with bound parameters',
						action: 'Call a procedure',
					},
					{
						name: 'Call Function',
						value: 'callFunction',
						description: 'Execute a scalar function and return its result',
						action: 'Call a function',
					},
				],
				default: 'callProcedure',
			},
			...operationFields,
		],
	};

	methods = {
		credentialTest: {
			async dbConnectionTest(
				this: ICredentialTestFunctions,
				credential: ICredentialsDecrypted,
			): Promise<INodeCredentialTestResult> {
				const credentials = credential.data as ICredentialDataDecryptedObject;
				try {
					await testConnection(credentials);
				} catch (error) {
					return {
						status: 'Error',
						message: (error as Error).message,
					};
				}
				return {
					status: 'OK',
					message: 'Connection successful!',
				};
			},
		},
		listSearch: {
			searchTables,
			searchRoutines,
			searchProcedures,
			searchFunctions,
			searchDbObjects,
		},
		loadOptions: {
			getColumns,
			getParameters,
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const credentials = await this.getCredentials('IbmDb2OdbcCredentialsApi');
		const resource = this.getNodeParameter('resource', 0) as string;

		if (resource === 'row') {
			const operation = this.getNodeParameter('operation', 0) as string;
			const tableRaw = this.getNodeParameter('tableId', 0);
			let table: string;
			try {
				table = resolveTable(tableRaw);
			} catch (e) {
				throw new NodeOperationError(this.getNode(), (e as Error).message);
			}

			switch (operation) {
				case 'create':
					return [await createItems(this, credentials, table)];
				case 'update':
					return [await updateItems(this, credentials, table)];
				case 'delete':
					return [await deleteItems(this, credentials, table)];
				case 'get':
					return [await getItems(this, credentials, table)];
				default:
					throw new NodeOperationError(
						this.getNode(),
						`Unsupported operation: ${operation}`,
					);
			}
		}

		if (resource === 'routine') {
			const operation = this.getNodeParameter('operation', 0) as string;
			switch (operation) {
				case 'callProcedure':
					return [await callRoutineItems(this, credentials, 'PROCEDURE')];
				case 'callFunction':
					return [await callRoutineItems(this, credentials, 'FUNCTION')];
				default:
					throw new NodeOperationError(
						this.getNode(),
						`Unsupported operation: ${operation}`,
					);
			}
		}

		return [await executeQueryAsync(this, credentials)];
	}
}
