import { describe, it, expect } from "vitest";
import { fnv1aHash64 } from "../lib/utils";

describe("fnv1aHash64", () => {
  it('should hash "Hello, World!" correctly', () => {
    const input = "Hello, World!";
    const result = fnv1aHash64(input);
    const expected = 7993990320990026836n;
    expect(result).toBe(expected);
  });
});
