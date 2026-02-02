import type { INodeProperties } from 'n8n-workflow';

export const operationFields: INodeProperties[] = [
	/* ================= SELECT COLUMNS ================= */
	{
	displayName: 'Select',
	name: 'select',
	type: 'fixedCollection',
	typeOptions: { multipleValues: true },
	default: {},
	displayOptions: {
		show: {
			operation: ['get'],
		},
	},
	options: [
		{
			name: 'fields',
			displayName: 'Field',
			values: [
				{
					displayName: 'Type',
					name: 'mode',
					type: 'options',
					options: [
						{ name: 'Column', value: 'column' },
						{ name: 'Aggregate', value: 'aggregate' },		
						{ name: 'Custom SQL', value: 'custom' },
					],
					default: 'column',
				},
				{
					displayName: 'Column',
					name: 'columnSelect',
					type: 'collection',
					default: {},
					displayOptions: {
						show: { mode: ['column'] },
					},
					options: [
						{
							displayName: 'Column',
							name: 'column',
							type: 'options',
							typeOptions: {
								loadOptionsMethod: 'getColumns',
							},
							default: '',
						},
						{
							displayName: 'Alias',
							name: 'alias',
							type: 'string',
							default: '',
						},
					],
				},			
				{
					displayName: 'Aggregate',
					name: 'aggregateSelect',
					type: 'collection',
					default: {},
					displayOptions: {
						show: { mode: ['aggregate'] },
					},
					options: [
						{
							displayName: 'Function',
							name: 'fn',
							type: 'options',
							options: [
								{ name: 'COUNT', value: 'COUNT' },
								{ name: 'SUM', value: 'SUM' },
								{ name: 'AVG', value: 'AVG' },
								{ name: 'MIN', value: 'MIN' },
								{ name: 'MAX', value: 'MAX' },
							],
							default: 'COUNT',
						},
						{
							displayName: 'Column',
							name: 'field',
							type: 'options',
							typeOptions: {
								loadOptionsMethod: 'getColumns',
							},
							default: '',
						},
						{
							displayName: 'Distinct',
							name: 'distinct',
							type: 'boolean',
							default: false,
						},
						{
							displayName: 'Alias',
							name: 'alias',
							type: 'string',
							default: '',
						},
					],
				},			
				{
					displayName: 'Custom SQL',
					name: 'customSql',
					type: 'collection',
					default: {},
					displayOptions: {
						show: { mode: ['custom'] },
					},
					options: [
						{
							displayName: 'Expression',
							name: 'expression',
							type: 'string',
							typeOptions: { rows: 3 },
							default: '',
						},
						{
							displayName: 'Alias',
							name: 'alias',
							type: 'string',
							default: '',
						},
					],
				}
			],
		},
	],
	},
	{
		displayName: 'Data to Send',
		name: 'dataToSend',
		type: 'options',
		options: [		
			{
				name: 'Define Below for Each Column',
				value: 'defineBelow',
				description: 'Set the value for each destination column',
			},
		],
		displayOptions: {
			show: {
				operation: ['create', 'update'],
			},
		},
		default: 'defineBelow',
		description: 'Whether to insert the input data this node receives in the new row',
	},
	{
	displayName: 'Columns to Set',
	name: 'columnUI',
	placeholder: 'Add Row',
	type: 'fixedCollection',
	typeOptions: {
		multipleValues: true,
	},
	displayOptions: {
		show: {
			operation: ['create', 'update','get'],
		},
	},
	default: {},
	options: [
		{
			name: 'items',
			displayName: 'Row',
			values: [
				{
					displayName: 'Columns',
					name: 'columns',
					type: 'fixedCollection',
					typeOptions: {
						multipleValues: true,
						multipleValueButtonText: 'Add Field',
					},
					default: {},
					options: [
						{
							name: 'fields',
							displayName: 'Field',
							values: [
								{
									displayName: 'Mode',
									name: 'mode',
									type: 'options',
									options: [
										{ name: 'Column', value: 'column' },
										{ name: 'Custom SQL Field', value: 'expression' },
									],
									default: 'column',
								},
								/* COLUMN MODE */
								{
									displayName: 'Column name of table',
									name: 'columnId',
									type: 'options',
									description: 'Choose DB column',
									typeOptions: {
										loadOptionsMethod: 'getColumns',
										loadOptionsDependsOn: ['tableId.value'],
									},
									default: '',
									displayOptions: { show: { mode: ['column'] } },
								},
								/* VALUE */
								{
									displayName: 'Type value',
									name: 'columnValue',
									type: 'string',
									default: '',
									typeOptions: {
										sqlDialect: 'StandardSQL',
										editor: 'sqlEditor',
										rows: 1,
									},
									placeholder: `Example: CAST('123' AS INT), CURRENT_TIMESTAMP, UPPER(...)`,
									displayOptions: { show: { mode: ['column'] } },
								},
								/* CUSTOM EXPRESSION */
								{
									displayName: 'SQL expression',
									name: 'sqlExpression',
									type: 'string',
									typeOptions: {
										sqlDialect: 'StandardSQL',
										editor: 'sqlEditor',
										rows: 2,
									},
									default: '',
									placeholder: `Column name of table`,
									displayOptions: { show: { mode: ['expression'] } },
								},
							],
						},
					],
				},				
			],
		},
	],
	},	
	/* ================= CONDITIONS ================= */
	{
	displayName: 'Where Conditions',
	name: 'additionalConditions',
	type: 'fixedCollection',
	typeOptions: { multipleValues: true },
	default: {},
	displayOptions: {
		show: {
			operation: ['get','update','delete'],
		},
	},
	options: [
		{
			name: 'groups',
			displayName: 'Condition Group',
			values: [
				/* AND / OR between filters inside this group */
				{
					displayName: 'Logical operators',
					name: 'filterType',
					type: 'options',
					options: [
						{ name: 'AND', value: 'AND' },
						{ name: 'OR', value: 'OR' },
					],
					default: 'AND',
				},
				/* GROUP FILTERS */
				{
					displayName: 'Operatiors',
					name: 'filters',
					type: 'fixedCollection',
					typeOptions: { multipleValues: true },
					default: {},
					options: [
						{
							name: 'fields',
							displayName: 'Filter',
							values: [
								/* MODE SWITCH */
								{
									displayName: 'Mode',
									name: 'mode',
									type: 'options',
									options: [
										{ name: 'Columns from table', value: 'column' },
										{ name: 'SQL Expression ', value: 'expression' },
										{ name: 'IN (Values)', value: 'column_in' },
										{ name: 'NOT IN (Values)', value: 'column_not_in' },
										{ name: 'Between', value: 'between' },
										{ name: 'Not Between', value: 'not_between' },
										{ name: 'Exists', value: 'exists' },
										{ name: 'Not Exists', value: 'not_exists' },
									],
									default: 'column',
								},

								/* === COLUMN MODE === */
								{
									displayName: 'Column',
									name: 'field',
									type: 'options',
									typeOptions: {
										loadOptionsMethod: 'getColumns',
										loadOptionsDependsOn: ['tableId'],
									},
									default: '',
									displayOptions: {
										show: {
											mode: [
												'column',
												'column_in',
												'column_not_in',
												'between',
												'not_between',												
											],
										},
									},
								},
								/* Allowed only for direct compare */
								{
									displayName: 'Operator',
									name: 'operator',
									type: 'options',
									options: [
										{ name: '=', value: 'equal' },
										{ name: '!=', value: 'not_equal' },
										{ name: '>', value: 'greater' },
										{ name: '<', value: 'less' },
										{ name: '>=', value: 'greater_equal' },
										{ name: '<=', value: 'less_equal' },
										{ name: 'Like', value: 'like' },
										{ name: 'Not like', value: 'not_like' },
										{ name: 'Contains', value: 'contains' },																	
										{ name: 'Is null', value: 'is_null' },
										{ name: 'Is not null', value: 'is_not_null' },										
									],
									default: 'equal',
									displayOptions: { show: { mode: ['column'] } },
								},
								{
									displayName: 'Value',
									name: 'value',
									type: 'string',
									default: '',
									displayOptions: { show: { mode: ['column'] } },
								},

								/* === IN / NOT IN === */
								{
									displayName: 'Values (comma-separated)',
									name: 'values',
									type: 'string',
									placeholder: 'A,B,C',
									default: '',
									displayOptions: {
										show: {
											mode: [
												'column_in',
												'column_not_in',
												'between',
												'not_between',
											],
										},
									},
								},
								/* === SUBQUERY === */
								{
									displayName: 'IN/NOT IN SQL Expression',
									name: 'sql',
									type: 'string',
									typeOptions: {
										sqlDialect: 'StandardSQL',
										editor: 'sqlEditor',
										rows: 4,
									},
									default: '',
									placeholder: 'SELECT ID FROM TABLE WHERE...',
									displayOptions: {
										show: {
											mode: ['expression_in', 'expression_not_in'],
										},
									},
								},
								/* === EXISTS === */
								{
									displayName: 'EXISTS / NOT EXISTS SQL Expression',
									name: 'existsQuery',
									type: 'string',
									typeOptions: { rows: 5 },
									default: '',
									placeholder: 'SELECT 1 FROM X WHERE X.ID = MAIN.ID',
									displayOptions: {
										show: { mode: ['exists', 'not_exists'] },
									},
								},

								/* === CUSTOM EXPRESSION === */
								{
									displayName: 'SQL Expression',
									name: 'expression',
									type: 'string',
									typeOptions: {
										sqlDialect: 'StandardSQL',
										editor: 'sqlEditor',
										rows: 3,
									},
									default: '',
									placeholder: '"AGE" > 18 AND "STATUS" = \'A\'',
									displayOptions: {
										show: { mode: ['expression'] },
									},
								},
							],
						},
					],
				},
			],
		},
		],
	},	
	/* ================= GROUP / HAVING / ORDER ================= */
	{
	displayName: 'Group By',
	name: 'groupBy',
	type: 'fixedCollection',
	typeOptions: { multipleValues: true },
	default: {},
	displayOptions: {
		show: {
			operation: ['get'],
		},
	},
	options: [
		{
			name: 'items',
			displayName: 'Group Field',
			values: [
				{
					displayName: 'Mode',
					name: 'mode',
					type: 'options',
					options: [
						{ name: 'Column', value: 'column' },
						{ name: 'SQL Expression', value: 'expression' },
					],
					default: 'column',
				},

				/* COLUMN */
				{
					displayName: 'Column',
					name: 'column',
					type: 'options',
					typeOptions: {
						loadOptionsMethod: 'getColumns',
						loadOptionsDependsOn: ['tableId'],
					},
					default: '',
					displayOptions: {
						show: {
							mode: ['column'],
						},
					},
				},

				/* EXPRESSION */
				{
					displayName: 'Expression',
					name: 'expression',
					type: 'string',				
					typeOptions: {
						sqlDialect: 'StandardSQL',
						editor: 'sqlEditor',
						rows: 3,
					},
					default: '',
					placeholder: 'YEAR(order_date) or CAST(col AS INT)',
					displayOptions: {
						show: {
							mode: ['expression'],
						},
					},
				},
			],
		},
	],
	},	
	// ================= HAVING CONDITIONS ================= */
	{
	displayName: 'Having Conditions',
	name: 'having',
	type: 'fixedCollection',
	typeOptions: { multipleValues: true },
	default: {},
	displayOptions: {
		show: {
			operation: ['get', 'getAll'],
		},
	},
	options: [
		{
			name: 'fields',
			displayName: 'Having Filter',
			values: [
				{
					displayName: 'Mode',
					name: 'mode',
					type: 'options',
					options: [
						{ name: 'Aggregate', value: 'aggregate' },
						{ name: 'Expression SQL', value: 'expression' },
					],
					default: 'aggregate',
				},
				/* AGGREGATE MODE */
				{
					displayName: 'Function',
					name: 'fn',
					type: 'options',
					options: [
						{ name: 'COUNT', value: 'COUNT' },
						{ name: 'SUM', value: 'SUM' },
						{ name: 'AVG', value: 'AVG' },
						{ name: 'MIN', value: 'MIN' },
						{ name: 'MAX', value: 'MAX' },
					],
					default: 'COUNT',
					displayOptions: { show: { mode: ['aggregate'] } },
				},
				{
					displayName: 'Field',
					name: 'field',
					type: 'options',
					typeOptions: {
						loadOptionsMethod: 'getColumns',
						loadOptionsDependsOn: ['tableId'],
					},
					default: '',
					displayOptions: { show: { mode: ['aggregate'] } },
				},

				/* shared ops */
				{
					displayName: 'Operator',
					name: 'operator',
					type: 'options',
					options: [
						{ name: '=', value: 'equal' },
						{ name: '!=', value: 'not_equal' },
						{ name: '>', value: 'greater' },
						{ name: '<', value: 'less' },
						{ name: '>=', value: 'greater_equal' },
						{ name: '<=', value: 'less_equal' },
					],
					default: 'equal',
					displayOptions: { show: { mode: ['aggregate'] } },
				},
				/* VALUE */
				{
					displayName: 'Value',
					name: 'value',
					type: 'string',
					default: '',
					displayOptions: { show: { mode: ['aggregate'] } },
				},
				/* EXPRESSION MODE */
				{
					displayName: 'SQL Expression',
					name: 'expression',
					type: 'string',
					typeOptions: {
						sqlDialect: 'StandardSQL',
						editor: 'sqlEditor',
						rows: 4,
					},
					default: '',
					displayOptions: { show: { mode: ['expression'] } },
				},
			],
		},
	],
	},
	{
	displayName: 'Order By',
	name: 'orderBy',
	type: 'fixedCollection',
	typeOptions: { multipleValues: true },
	default: {},
	displayOptions: {
		show: {
			operation: ['get'],
		},
	},
	options: [
		{
			name: 'fields',
			displayName: 'Order Rule',
			values: [
				{
					displayName: 'Mode',
					name: 'mode',
					type: 'options',
					options: [
						{ name: 'Column', value: 'column' },
						{ name: 'Expression SQL', value: 'expression' },
					],
					default: 'column',
				},
				{
					displayName: 'Column',
					name: 'column',
					type: 'options',
					typeOptions: {
						loadOptionsMethod: 'getColumns',
						loadOptionsDependsOn: ['tableId'],
					},
					default: '',
					displayOptions: { show: { mode: ['column'] } },
				},
				{
					displayName: 'SQL Expression',
					name: 'expression',
					type: 'string',
					typeOptions: {
						sqlDialect: 'StandardSQL',
						editor: 'sqlEditor',
						rows: 3,
					},
					default: '',
					displayOptions: { show: { mode: ['expression'] } },
				},
				{
					displayName: 'Direction',
					name: 'direction',
					type: 'options',
					options: [
						{ name: 'ASC', value: 'ASC' },
						{ name: 'DESC', value: 'DESC' },
					],
					default: 'ASC',
				},
			],
		},
	],
	},
	/* ============================ EXECUTE SQL ============================ */
	{
		displayName: 'Use Transaction',
		name: 'useTransaction',
		type: 'boolean',
		default: false,
		displayOptions: {
			show: { resource: ['executeSQL'] },
		},
	},
	{
		displayName: 'Stop On Error',
		name: 'stopOnError',
		type: 'boolean',
		default: true,
		displayOptions: {
			show: { resource: ['executeSQL'] },
		},
	},
	{
		displayName: 'Preview query',
		name: 'previewSQL',
		type: 'boolean',
		default: true,
		displayOptions: {
			show: { resource: ['executeSQL'] },
		},
	},
	{
		displayName: 'Outputs',
		name: 'returnMode',
		type: 'options',
		default: 'all',
		options: [
			{ name: 'All Outputs', value: 'all' },
			{ name: 'Merge Output', value: 'merge' },
			{ name: 'Last Output Only', value: 'last' },
			{ name: 'Only Specific Output', value: 'specific' },
		],
		displayOptions: {
			show: { resource: ['executeSQL'] },
		},
	},
	{
		displayName: 'Specific Output Index',
		name: 'returnOutput',
		type: 'number',
		default: 0,
		displayOptions: {
			show: { returnMode: ['specific'] },
		},
	},
	{
		displayName: 'Execute SQL',
		name: 'queries',
		type: 'fixedCollection',
		default: {},
		typeOptions: {
			multipleValues: true,
			multipleValueButtonText: 'Add Query',
		},
		displayOptions: {
			show: { resource: ['executeSQL'] },
		},
		options: [
			{
				displayName: 'Query',
				name: 'query',
				values: [
				{
					displayName: 'SQL',
					name: 'sql',
					type: 'string',
					required: true,
					default: '',
					typeOptions: {
						editor: 'sqlEditor',
						sqlDialect: 'StandardSQL',
						rows: 4,
						editorHint: `
							Supports:
							• ?  (positional)
							• :name (named)

							Examples:
							WHERE id = :id
							AND status IN (:statuses)
							AND created BETWEEN :from AND :to
							`,
					},
				},			
				/* ========================== PARAMETERS ========================== */
				{
					displayName: 'Parameters',
					name: 'binding',
					type: 'fixedCollection',
					typeOptions: {
						multipleValues: true,
						multipleValueButtonText: 'Add Parameter',
					},
					default: {},
					options: [
					{
						displayName: 'Parameter',
						name: 'parameterValues',
						values: [
							{
								displayName: 'Type',
								name: 'type',
								type: 'options',
								default: 'string',
								options: [
									{ name: 'String', value: 'string' },
									{ name: 'Number', value: 'number' },
									{ name: 'Boolean', value: 'boolean' },
									{ name: 'Date', value: 'date' },
									{ name: 'Null', value: 'null' },
								],
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
								description:
									'Bind in order of appearance (:name first, then ?). Supports ${context.outputX}.',
							},
						],
					},
				],
				},
				/* ======================== TRANSFORM ======================== */
					{
						displayName: 'Transform result',
						name: 'transform',
						type: 'string',
						default: '',
						typeOptions: {
							editor: 'jsEditor',
							rows: 4,
							editorHint: `Available variables:
							- result        (raw query result)
							- context.output0
							- context.output1
							- context.output2
							`
						},						
					},
				],
			},
		],
	},
];