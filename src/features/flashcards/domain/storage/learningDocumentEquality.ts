/** Compare JSON learning values structurally; record insertion order is irrelevant. */
export function equalLearningValue(left: unknown, right: unknown): boolean {
	if (left === right) return true;
	if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
		return false;
	}
	if (Array.isArray(left) || Array.isArray(right)) {
		return (
			Array.isArray(left) &&
			Array.isArray(right) &&
			left.length === right.length &&
			left.every((value, index) => equalLearningValue(value, right[index]))
		);
	}
	const leftRecord = left as Record<string, unknown>;
	const rightRecord = right as Record<string, unknown>;
	const keys = Object.keys(leftRecord);
	return (
		keys.length === Object.keys(rightRecord).length &&
		keys.every(
			(key) =>
				Object.prototype.hasOwnProperty.call(rightRecord, key) &&
				equalLearningValue(leftRecord[key], rightRecord[key]),
		)
	);
}
