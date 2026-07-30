export function buildLimit(limit?: number): string {
	if (limit === undefined || limit === null) return '';
	const n = Number(limit);
	if (!Number.isInteger(n) || n <= 0) {
		throw new Error('Limit must be a positive integer');
	}
	if (n > 100000) {
		throw new Error('Limit cannot exceed 100000');
	}
	return `FETCH FIRST ${n} ROWS ONLY`;
}
