
// WHERE CONDITIONS
export type LogicalOp = 'AND' | 'OR';

export type ConditionOperator =
	| 'EQUAL'
	| 'NOT_EQUAL'
	| 'GREATER_THAN'
	| 'LESS_THAN'
	| 'GREATER_EQUAL'
	| 'LESS_EQUAL'
	| 'LIKE'
	| 'IN'
	| 'BETWEEN'
	| 'IS NULL'
	| 'IS NOT NULL'
	| 'EXISTS'
	| 'NOT EXISTS'
	| 'NOT LIKE'
	| 'NOT IN'
	| 'NOT BETWEEN'
	| 'CONTAINS';

export interface ColumnCondition {
	mode: 'column' | 'column_in' | 'column_not_in' | 'between' | 'not_between';
	column: string;
	operator: ConditionOperator;
	value?: any;
	values?: any[]; // IN / BETWEEN
}

export interface ExistsCondition {
	mode: 'exists' | 'not_exists';
	operator: 'EXISTS' | 'NOT EXISTS';
	sql: string; // correlated SQL
}

export interface SubqueryCondition {
	mode: 'subquery_in' | 'subquery_not_in';
	column: string;
	operator: 'IN' | 'NOT IN';
	sql: string;
}

export interface CustomCondition {
	mode: 'expression';
	sql: string;
}

export type WhereCondition =
	| ColumnCondition
	| ExistsCondition
	| SubqueryCondition
	| CustomCondition;

export interface WhereGroup {
	filterType: LogicalOp;
	conditions?: WhereCondition[];
	groups?: WhereGroup[];
}
