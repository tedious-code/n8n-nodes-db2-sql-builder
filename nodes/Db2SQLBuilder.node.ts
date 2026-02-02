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
} from 'n8n-workflow';

import {
	testConnection,
	resolveTable,
	createItems,
	updateItems,
	getItems,
	deleteItems,
} from './GenericFunctions';
import { operationFields } from './OperationDescription';
import { getColumns, loadTables, searchTables } from './schemaCache';
import { executeQueryAsync } from './executeSQL/ExecuteQuery';

export class Db2SQLBuilder implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Db2SqlBuilder',
		name: 'db2sqlbuilder',
		icon: 'file:IbmDb2.svg',
		group: ['output'],
		version: 1,
		description: 'Ibm Db2 SQL Builder',
		subtitle: '={{$parameter["operation"] + ":" + $parameter["resource"]}}',
		defaults: {
			name: 'Db2SqlBuilder',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'IbmDb2OdbcCredentialsApi',
				required: true,
				testedBy: 'dbConnectionTest',
			}],
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
						name: 'Execute Query',
						value: 'executeSQL',
					},
				],
				default: 'row',
			},
			// ----------------------------------
			//             shared
			// ----------------------------------
			{
			displayName: 'Table Restriction',
			name: 'allowTables',
			type: 'multiOptions',
			required: true,
			default: ['*'],
			typeOptions: {
				loadOptionsMethod: 'loadTables', 
			},
			description: 'Select one or multiple tables allowed. Select \'*\' to allow all tables.',
			// displayOptions: {
			// 	show: {
			// 		operation: ['delete', 'get', 'update', 'create', 'executeSQL'],
			// 	},
			// },
			},	
			{
				displayName: 'Allow only select operation',
				name: 'onlySelect',
				type: 'boolean',
				default: false,
				// displayOptions: {
				// 	show: {
				// 		operation: ['delete', 'get', 'update', 'create', 'executeSQL'],
				// 	},
				// },
			},
			{
				displayName: 'Tables',
				name: 'tableId',
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				required: true,
				description: 'Table to operate on allowed tables from Table Restriction option.',
				modes: [
					{
						displayName: 'From List',
						name: 'list',
						type: 'list',
						placeholder: 'Select a Table...',
						typeOptions: {
							searchListMethod: 'searchTables',
							searchFilterRequired: false,
							searchable: true,
						},
					},
					{
						displayName: 'Name',
						name: 'name',
						type: 'string',
						placeholder: 'table_name',
					},
				],
				displayOptions: {
					show: {
						resource: ['row'],
						// operation: ['delete', 'get', 'update', 'create'],
					},
				},
			},
			{
				displayName: 'Limit to Select Only',
				name: 'limitSelect',
				type: 'number',
				default: 200,
				displayOptions: {
					show: {
						resource: ['row', 'executeSQL'],
						operation: ['get','executeSQL'],
					},
				},
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				description: 'Operation to perform on the table.',
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
						message: error.message,
					};
				}
				return {
					status: 'OK',
					message: 'Connection successful!',
				};
			},
		},
		listSearch:{
			searchTables,			
		},
		loadOptions: {
			getColumns,		
			loadTables
		},
	};

// ======================================================
	// EXECUTE
	// ======================================================
	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const credentials = await this.getCredentials('IbmDb2OdbcCredentialsApi');
		try {
			const resource = this.getNodeParameter('resource', 0) as string;
			if(resource == 'row'){
				const operation = this.getNodeParameter('operation', 0) as string;
				const tableRaw = this.getNodeParameter('tableId', 0);
				const table = resolveTable(tableRaw);						
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
						(operation)
						throw new Error(`Unsupported operation: ${operation}`);
				}
			}
			else {				
				return [await executeQueryAsync(this, credentials)];				
			}
		} finally {
		}
	}
}
