export type LogicalOp = 'AND' | 'OR';

/** Operators as used by the UI / normalizeUiWhere (uppercased). */
export type ConditionOperator =
	| 'EQUAL'
	| 'NOT_EQUAL'
	| 'GREATER'
	| 'LESS'
	| 'GREATER_EQUAL'
	| 'LESS_EQUAL'
	| 'LIKE'
	| 'NOT_LIKE'
	| 'CONTAINS'
	| 'IS_NULL'
	| 'IS_NOT_NULL'
	| 'IN'
	| 'NOT_IN'
	| 'BETWEEN'
	| 'NOT_BETWEEN'
	| 'EXISTS'
	| 'NOT EXISTS'
	| 'COLUMN_IN'
	| 'COLUMN_NOT_IN';

export interface ColumnCondition {
	mode: 'column' | 'column_in' | 'column_not_in' | 'between' | 'not_between';
	column: string;
	operator?: ConditionOperator;
	value?: any;
	values?: any[];
}

export interface ExistsCondition {
	mode: 'exists' | 'not_exists';
	operator: 'EXISTS' | 'NOT EXISTS';
	sql: string;
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
