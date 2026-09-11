import { describe, expect, it } from "vitest";
import { buildNotificationDedupKey, isCounterClosedStatusText, shouldSuppressDuplicateNotification } from "./notifications";

describe("notification deduplication", () => {
  it("uses the same deduplication key for the same service event", () => {
    const payloadA = {
      flight_iata: "PC12",
      wheelchair_id: "W-1",
      passenger_type: "WCH",
      assigned_staff: "Ali",
      terminal: "T1",
      created_by: "Zeynep",
      notes: "Yardım gerekli",
      created_at: "2025-01-01T12:00:00.000Z",
      notification_kind: "service-created" as const,
    };

    const payloadB = {
      ...payloadA,
      created_at: "2025-01-01T12:05:00.000Z",
    };

    expect(buildNotificationDedupKey(payloadA)).toBe(buildNotificationDedupKey(payloadB));
  });

  it("suppresses a duplicate notification within the dedupe window", () => {
    const payload = {
      flight_iata: "PC12",
      wheelchair_id: "W-1",
      passenger_type: "WCH",
      assigned_staff: "Ali",
      terminal: "T1",
      created_by: "Zeynep",
      notes: "Yardım gerekli",
      created_at: "2025-01-01T12:00:00.000Z",
      notification_kind: "service-created" as const,
    };

    const now = Date.now();
    expect(shouldSuppressDuplicateNotification(payload, now)).toBe(false);
    expect(shouldSuppressDuplicateNotification(payload, now + 5000)).toBe(true);
  });

  it("detects TAV/TAV2 counter-closed status text", () => {
    expect(isCounterClosedStatusText("Kontuar Kapandı")).toBe(true);
    expect(isCounterClosedStatusText("Kapi kapali")).toBe(true);
    expect(isCounterClosedStatusText("Kontuar Açık")).toBe(false);
    expect(isCounterClosedStatusText("")) .toBe(false);
  });
});
