import { describe, expect, it } from "vitest";

import { getDefaultAirlineTerminalRules, resolveServiceFlightTerminal } from "@/lib/flight-rules";

describe("resolveServiceFlightTerminal", () => {
  it("returns T2 for configured T2 airlines on terminal 2", () => {
    const rules = getDefaultAirlineTerminalRules();
    expect(resolveServiceFlightTerminal("B2", "T2", rules)).toBe("T2");
    expect(resolveServiceFlightTerminal("4M", "2", rules)).toBe("T2");
  });

  it("keeps PC mapped according to departure terminal", () => {
    const rules = getDefaultAirlineTerminalRules();
    expect(resolveServiceFlightTerminal("PC", "T1", rules)).toBe("T1");
    expect(resolveServiceFlightTerminal("PC", "T2", rules)).toBe("T2");
  });

  it("returns null for airlines without a rule", () => {
    const rules = getDefaultAirlineTerminalRules();
    expect(resolveServiceFlightTerminal("TK", "T1", rules)).toBeNull();
    expect(resolveServiceFlightTerminal("TK", "T2", rules)).toBeNull();
  });
});