import { describe, expect, it } from "vitest";
import { isBcbpData, parseBCBP } from "./bcbp";

describe("parseBCBP", () => {
  it("parses mandatory fixed-width fields and optional data", () => {
    const mandatory = [
      "M",
      "1",
      "DOE/JOHN MR".padEnd(20, "<"),
      "E",
      "ABC1234",
      "IST",
      "LHR",
      "TK ",
      "01234",
      "270",
      "Y",
      "12A ",
      "00042",
      "0",
    ].join("");
    const parsed = parseBCBP(`${mandatory.padEnd(60, "<")}BOARDING 0830 BAGGAGE 20 KG`);

    expect(isBcbpData(parsed)).toBe(true);
    expect(parsed.passengerName).toBe("JOHN MR DOE");
    expect(parsed.pnr).toBe("ABC1234");
    expect(parsed.origin).toBe("IST");
    expect(parsed.destination).toBe("LHR");
    expect(parsed.airline).toBe("TK");
    expect(parsed.flightNumber).toBe("01234");
    expect(parsed.cabinClass).toBe("Y");
    expect(parsed.seat).toBe("12A");
    expect(parsed.sequenceNumber).toBe("00042");
    expect(parsed.boardingTime).toBe("08:30");
    expect(parsed.baggageAllowance).toBe("20 KG");
  });

  it("does not treat arbitrary barcode text as BCBP", () => {
    const parsed = parseBCBP("hello world");
    expect(isBcbpData(parsed)).toBe(false);
    expect(parsed.rawValue).toBe("hello world");
  });
});
