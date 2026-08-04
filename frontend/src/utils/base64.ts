/**
 * Base64 ⇄ bytes, for the payloads that cannot cross the bridge as text.
 *
 * Anything binary — an image blob from `git cat-file`, terminal output, a
 * keystroke that is really an escape sequence — is base64 on the wire, because
 * JSON strings are UTF-8 and `encoding/json` silently replaces every invalid
 * byte with U+FFFD. These are the two functions that undo that encoding, and
 * they exist here rather than inline so the chunking below is written once.
 */

/**
 * Decode base64 into raw bytes.
 *
 * Returns bytes rather than a string on purpose: the caller usually wants to
 * hand them to something that reassembles UTF-8 itself (xterm.js, a Blob), and
 * decoding to text here would have to guess an encoding and would break a
 * multi-byte rune split across two chunks.
 */
export function base64ToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * The largest number of bytes passed to `String.fromCharCode` at once.
 *
 * Spreading an array into a call is spreading it onto the *stack*: a 128 KB
 * payload — which the terminal produces routinely, since that is the Go side's
 * flush threshold — throws RangeError on Safari's JavaScriptCore, the engine
 * the macOS webview uses. Chunking is not an optimisation here, it is the
 * difference between working and not.
 */
const CHUNK = 0x8000;

/** Encode raw bytes as base64. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

/** Encode a string as base64 of its UTF-8 bytes. */
export function textToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}
