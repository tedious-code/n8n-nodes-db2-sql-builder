export interface ColumnSchema {
	name: string;
	type: string | null;
	isNumeric: boolean | null;
	isDate: boolean | null;
	isString: boolean | null;
}



export interface SelectItem {
	mode: 'column' | 'aggregate' | 'custom';

	columnSelect?: {
		column: string;
		alias?: string;
	};

	aggregateSelect?: {
		fn: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX';
		field?: string;
		distinct?: boolean;
		alias?: string;
	};
	
	customSql?: {
		expression: string;
		alias?: string;
	};
}
