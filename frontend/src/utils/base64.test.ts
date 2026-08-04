import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64, textToBase64 } from './base64';

describe('base64', () => {
  it('round-trips ASCII', () => {
    // Compared as plain arrays: under jsdom, TextEncoder returns a Uint8Array
    // built in Node's realm while `base64ToBytes` builds one in the document's,
    // and `toEqual` compares constructors before contents.
    expect(Array.from(base64ToBytes(textToBase64('git status')))).toEqual(
      Array.from(new TextEncoder().encode('git status')),
    );
  });

  it('matches the reference encoding', () => {
    // Pinned against a value produced by Go's encoding/base64, since that is
    // what is on the other end of the bridge.
    expect(textToBase64('moonGit')).toBe('bW9vbkdpdA==');
    expect(new TextDecoder().decode(base64ToBytes('bW9vbkdpdA=='))).toBe('moonGit');
  });

  /*
   * The point of the encoding. 0xff is not valid UTF-8 in any position, and a
   * plain JSON string would return it as U+FFFD with no error anywhere —
   * asserted from the other side in internal/ptyapi/service_test.go.
   */
  it('carries bytes that are not valid UTF-8', () => {
    const raw = new Uint8Array([0x73, 0x74, 0xff, 0x00, 0xfe, 0x64]);
    expect(base64ToBytes(bytesToBase64(raw))).toEqual(raw);
  });

  it('keeps a multi-byte rune intact', () => {
    expect(new TextDecoder().decode(base64ToBytes(textToBase64('→ café 🌙')))).toBe('→ café 🌙');
  });

  it('encodes payloads larger than one stack-safe chunk', () => {
    // Above the 0x8000 spread limit and above the Go side's 128 KB flush
    // threshold, which is the size that actually arrives from a busy shell.
    const big = new Uint8Array(200_000);
    for (let i = 0; i < big.length; i += 1) big[i] = i % 256;

    expect(base64ToBytes(bytesToBase64(big))).toEqual(big);
  });

  it('handles empty input', () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe('');
    expect(base64ToBytes('')).toEqual(new Uint8Array(0));
  });
});
