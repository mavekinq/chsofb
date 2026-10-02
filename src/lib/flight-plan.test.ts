import { describe, expect, it } from "vitest";
import { getFlightCodeMatchKeys } from "./flight-plan";

describe("getFlightCodeMatchKeys", () => {
  it("matches flight numbers with or without leading zeroes", () => {
    const shortCodeKeys = getFlightCodeMatchKeys("PC511");
    const paddedCodeKeys = getFlightCodeMatchKeys("PC0511");

    expect(shortCodeKeys.some((key) => paddedCodeKeys.includes(key))).toBe(true);
  });

  it("preserves airline aliases while normalizing flight-number zeroes", () => {
    const flightCodeKeys = getFlightCodeMatchKeys("PGT0511");
    const ticketCodeKeys = getFlightCodeMatchKeys("PC511");

    expect(flightCodeKeys.some((key) => ticketCodeKeys.includes(key))).toBe(true);
  });

  it("keeps an all-zero flight number matchable", () => {
    const allZeroKeys = getFlightCodeMatchKeys("PC000");
    const zeroFlightKeys = getFlightCodeMatchKeys("PC0");

    expect(allZeroKeys).toContain("PC000");
    expect(allZeroKeys.some((key) => zeroFlightKeys.includes(key))).toBe(true);
  });
});
