import { describe, it, expect, beforeAll } from "vitest";
import { encrypt, decrypt } from "./crypto";

beforeAll(() => {
  // 32 bytes en base64, solo para pruebas.
  process.env.APP_ENCRYPTION_KEY = "p+pBykdiSeOlSE1N2XZPOd0ClynuZVegAXQcqwgStYo=";
});

describe("crypto", () => {
  it("decrypts back to the original plaintext", () => {
    const plaintext = "EAAG-un-access-token-de-whatsapp-super-secreto";
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const plaintext = "mismo-texto";
    expect(encrypt(plaintext)).not.toBe(encrypt(plaintext));
  });

  it("throws when the ciphertext has been tampered with", () => {
    const ciphertext = encrypt("dato-sensible");
    const tampered = ciphertext.slice(0, -4) + "abcd";
    expect(() => decrypt(tampered)).toThrow();
  });

  it("throws a clear error when APP_ENCRYPTION_KEY is missing", () => {
    const original = process.env.APP_ENCRYPTION_KEY;
    delete process.env.APP_ENCRYPTION_KEY;
    expect(() => encrypt("x")).toThrow(/APP_ENCRYPTION_KEY/);
    process.env.APP_ENCRYPTION_KEY = original;
  });
});
