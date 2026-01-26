import { ColumnSchema } from "../type";

export function buildHaving(
    having: any,
    schema: Record<string, ColumnSchema>,
) {
    console.log('Building Having:', JSON.stringify(having, null, 2));
    if (Object.keys(having).length === 0)  return { sql: '', values: [] };
    if (having.fields && having.fields.length === 0) return { sql: '', values: [] };
            
    const clauses: string[] = [];
    const values: any[] = [];

    for (const h of having.fields) {
        if(h.mode == 'aggregate') {
            if(h.fn === 'COUNT') {
                if(h.field === '*') {
                    clauses.push(`COUNT(*) ${buildHavingOperator(h.operator)} ?`);
                } else {
                    clauses.push(`COUNT(${h.field}) ${buildHavingOperator(h.operator)} ?`);
                    values.push(Number(h.value));
                }
            } else {
                const col = schema[h.column!];
                if (!col) throw new Error(`Unknown having column "${h.column}"`);
                if (!col.isNumeric) {
                    throw new Error(`HAVING ${h.fn} requires numeric column`);
                }
                clauses.push(`${h.fn}(DECIMAL("${col.name}",18,2)) ${buildHavingOperator(h.operator)} ?`);
                values.push(Number(h.value));
            } 
        } else {
            if(!h.expression || h.expression.trim() === '') {
                throw new Error(`HAVING expression is required`);
            }
            clauses.push(`${h.expression}`);
        }
    }
    console.log('Having Clauses:', clauses);
    console.log('Having Values:', values);
    return {
        sql: `HAVING ${clauses.join(',')}`,
        values,
    };
}

function buildHavingOperator(operator: string): string {
    switch(operator.toUpperCase()) {
        case 'GREATER':
            return '>';
        case 'LESS':
            return '<';
        case 'EQUAL':
            return '=';
        case 'NOT_EQUAL':
            return '!=';     
        case 'GREATER_EQUAL':
            return '>=';
        case 'LESS_EQUAL':
            return '<=';  
        default:
            throw new Error(`Unsupported HAVING operator: ${operator}`);
    }
}   
