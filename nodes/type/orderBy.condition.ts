export interface OrderByItem {
	mode: 'column' | 'expression';
	column?: string;
	expression?: string;
	direction?: 'ASC' | 'DESC';
}
