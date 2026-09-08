const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
	const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
	const binary = atob(normalized);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	return buffer;
}

async function keyFromSecret(secret: string): Promise<CryptoKey> {
	const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
	return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(value: string, secret: string): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: arrayBuffer(iv) }, await keyFromSecret(secret), encoder.encode(value));
	return `${base64Url(iv)}.${base64Url(new Uint8Array(encrypted))}`;
}

export async function decryptSecret(value: string, secret: string): Promise<string> {
	const [ivValue, encryptedValue] = value.split(".");
	if (!ivValue || !encryptedValue) throw new Error("Invalid encrypted credential");
	const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: arrayBuffer(fromBase64Url(ivValue)) }, await keyFromSecret(secret), arrayBuffer(fromBase64Url(encryptedValue)));
	return new TextDecoder().decode(decrypted);
}

export function randomToken(bytes = 32): string {
	return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function hashToken(value: string): Promise<string> {
	return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

export async function pkceChallenge(verifier: string): Promise<string> {
	return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier))));
}

export async function signPayload(payload: string, secret: string): Promise<string> {
	const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload))));
}
