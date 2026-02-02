import { INodeType } from 'n8n-workflow';
import { Db2SQLBuilder } from './nodes/Db2SQLBuilder.node';
export const nodeTypes: INodeType[] = [  
	new Db2SQLBuilder(),
];
