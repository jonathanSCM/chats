import { describe, it, expect } from "vitest";
import { generateToken, hashToken } from "./tokens";

describe("tokens", () => {
  it("generates a token whose hash matches hashToken(token)", () => {
    const { token, tokenHash } = generateToken();
    expect(hashToken(token)).toBe(tokenHash);
  });

  it("generates a different token on every call", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  it("never exposes the raw token as a substring of its own hash", () => {
    const { token, tokenHash } = generateToken();
    expect(tokenHash).not.toContain(token);
  });

  it("hashToken is deterministic", () => {
    const { token } = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
  });
});
