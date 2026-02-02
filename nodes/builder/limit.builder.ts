export function buildLimit(limit?: number): string {
	if (!limit || limit <= 0) return '';
	return `FETCH FIRST ${limit} ROWS ONLY`;
}
