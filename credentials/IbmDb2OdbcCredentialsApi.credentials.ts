import {
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class IbmDb2OdbcCredentialsApi implements ICredentialType {
	name = 'IbmDb2OdbcCredentialsApi';
	displayName = 'IBM DB2 Credential';
	documentationUrl =
		'https://www.ibm.com/docs/en/db2/11.5?topic=applications-supported-drivers-clients';

	properties: INodeProperties[] = [
		{
			displayName: 'Host',
			name: 'host',
			type: 'string',
			required: true,
			default: 'localhost',
			description: 'Db2 hostname (connections use @foxschema/core Db2 adapter + ibm_db)',
		},
		{
			displayName: 'Database',
			name: 'database',
			type: 'string',
			required: true,
			default: '',
		},
		{
			displayName: 'Username',
			name: 'username',
			type: 'string',
			required: true,
			default: '',
		},
		{
			displayName: 'Password',
			name: 'password',
			type: 'string',
			typeOptions: {
				password: true,
			},
			required: true,
			default: '',
		},
		{
			displayName: 'Port',
			name: 'port',
			type: 'number',
			default: 50000,
		},
		{
			displayName: 'Protocol',
			name: 'protocol',
			type: 'options',
			options: [
				{ name: 'TCPIP', value: 'TCPIP' },
				{ name: 'TCPIP_SSL', value: 'TCPIP_SSL' },
			],
			default: 'TCPIP',
			description: 'TCPIP_SSL also enables SSL Security=SSL in the foxSchema Db2 connection string',
		},
		{
			displayName: 'Schema',
			name: 'schema',
			type: 'string',
			default: 'DB2INST1',
			description: 'DB2 schema used to qualify tables (defaults to DB2INST1)',
		},
		{
			displayName: 'Use SSL',
			name: 'useSsl',
			type: 'boolean',
			default: false,
			description: 'When enabled, foxSchema sets Security=SSL on the Db2 connection',
		},
	];
}
