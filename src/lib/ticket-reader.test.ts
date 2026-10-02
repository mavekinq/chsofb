import { describe, expect, it } from "vitest";
import { parseTicket } from "./ticket-reader";

describe("parseTicket", () => {
  it("extracts passenger details from readable ticket text", () => {
    expect(parseTicket([
      "Passenger: Jane Doe",
      "Flight: TK1234",
      "PNR: ABC123",
      "Seat: 12A",
      "Destination: IST",
    ].join("\n"))).toEqual({
      passengerName: "Jane Doe",
      flightCode: "TK1234",
      pnr: "ABC123",
      seat: "12A",
      destination: "IST",
    });
  });

  it("extracts passenger details from a BCBP barcode", () => {
    const mandatory = [
      "M",
      "1",
      "DOE/JOHN MR".padEnd(20, "<"),
      "E",
      "ABC1234",
      "AYT",
      "IST",
      "TK ",
      "01234",
      "270",
      "Y",
      "12A ",
      "00042",
      "0",
    ].join("").padEnd(60, "<");

    expect(parseTicket(mandatory)).toMatchObject({
      passengerName: "JOHN MR DOE",
      flightCode: "TK01234",
      pnr: "ABC1234",
      seat: "12A",
      destination: "IST",
    });
  });
});
