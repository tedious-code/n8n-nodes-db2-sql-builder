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
			displayName: 'Schema',
			name: 'schema',
			type: 'string',
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
		},
		{
			displayName: 'Use SSL',
			name: 'useSsl',
			type: 'boolean',
			default: false,
		},
	];
}
