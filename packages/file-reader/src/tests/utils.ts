import { expect } from "vitest";

/**
 * Helper function to compare arrays of floating point numbers with a specified tolerance
 * @param actual The actual array from the test
 * @param expected The expected values
 * @param tolerance Maximum allowed difference (default: 0.01)
 * @param message Optional message to display on failure
 */
export function expectFloatArrayToBeClose(
  actual: ArrayLike<number>,
  expected: number[],
  tolerance: number = 0.01,
  message: string = "Array values should match within tolerance"
): void {
  // Check array lengths match
  expect(actual.length, `${message} (array length mismatch)`).toEqual(expected.length);

  // Check each value with tolerance
  for (let i = 0; i < expected.length; i++) {
    const diff = Math.abs(actual[i] - expected[i]);
    expect(
      diff,
      `${message} at index ${i}: expected ${expected[i]}, got ${actual[i]}, difference ${diff}`
    ).toBeLessThanOrEqual(tolerance);
  }

  // If test gets here, all values matched within tolerance
  console.log(`Successfully verified ${expected.length} values within tolerance of ${tolerance}`);
}
