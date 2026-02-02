export interface HavingCondition {
	fn: AggregateFn;
	column?: string; 
	operator: '=' | '>' | '<' | '>=' | '<=' | '<>';
	value: any;
}

type AggregateFn = 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COUNT';

export interface AggregateField {
	fn: AggregateFn;
	field: string;
	alias?: string;
}

export interface AggregateSelect {
	fn: AggregateFn;
	field: string;
	alias?: string;
	distinct?: boolean;
}

