const CRLF = "\r\n";
const encoder = new TextEncoder();

interface MultipartField {
	name: string;
	value: string;
}

interface MultipartFile {
	name: string;
	filename: string;
	contentType: string;
	bytes: ArrayBuffer;
}

export function createMultipartBoundary(): string {
	return `----study-studio-${crypto.randomUUID()}`;
}

/**
 * Serializes a multipart/form-data body into bytes.
 *
 * The audio bytes must never pass through a JavaScript string: the runtime
 * writes strings as UTF-8, so 0x80–0xFF would expand and corrupt the WAV.
 */
export function buildMultipartBody(
	fields: readonly MultipartField[],
	file: MultipartFile,
	boundary: string,
): ArrayBuffer {
	const parts: Uint8Array[] = [];
	const push = (text: string) => parts.push(encoder.encode(text));
	for (const field of fields) {
		push(`--${boundary}${CRLF}`);
		push(`Content-Disposition: form-data; name="${field.name}"${CRLF}${CRLF}`);
		push(`${field.value}${CRLF}`);
	}
	push(`--${boundary}${CRLF}`);
	push(`Content-Disposition: form-data; name="${file.name}"; filename="${file.filename}"${CRLF}`);
	push(`Content-Type: ${file.contentType}${CRLF}${CRLF}`);
	parts.push(new Uint8Array(file.bytes));
	push(`${CRLF}--${boundary}--${CRLF}`);

	let total = 0;
	for (const part of parts) total += part.byteLength;
	const result = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		result.set(part, offset);
		offset += part.byteLength;
	}
	return result.buffer as ArrayBuffer;
}
