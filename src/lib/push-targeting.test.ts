import { describe, expect, it } from "vitest";
import {
  getEligiblePushSubscriptions,
  getOnShiftNamesFromSchedule,
  getSubscriptionsWithServiceAlertsEnabled,
} from "../../supabase/functions/_shared/push-targeting";

const subscriptions = [
  { user_name: "Ali" },
  { user_name: "Zeynep" },
  { user_name: "Burak" },
];
const now = new Date("2026-10-02T02:30:00.000Z");
const schedule = {
  weekDates: ["2026-10-01", "2026-10-02", "2026-10-03"],
  employees: [
    { name: "Ali", shifts: { "2026-10-02": "0500-1400" } },
    { name: "Zeynep", shifts: { "2026-10-02": "1400-2200" } },
    { name: "Burak", shifts: { "2026-10-01": "2200-0600" } },
  ],
};

describe("getSubscriptionsWithServiceAlertsEnabled", () => {
  it("excludes users who disabled service alerts", () => {
    expect(getSubscriptionsWithServiceAlertsEnabled(
      subscriptions,
      [
        { full_name: "Zeynep", service_alerts_enabled: false },
        { full_name: "Burak", service_alerts_enabled: true },
      ],
      "service-created",
    )).toEqual([
      { user_name: "Ali" },
      { user_name: "Burak" },
    ]);
  });

  it("keeps announcements broadcast regardless of service alert preferences", () => {
    expect(getSubscriptionsWithServiceAlertsEnabled(
      subscriptions,
      [{ full_name: "Ali", service_alerts_enabled: false }],
      "announcement",
    )).toEqual(subscriptions);
  });
});

describe("getEligiblePushSubscriptions", () => {
  it("uses the central current shift schedule, not a stale client recipient list", () => {
    expect(getEligiblePushSubscriptions(subscriptions, "flight-note", ["Ali", "Zeynep", "Burak"], schedule, now)).toEqual([
      { user_name: "Ali" },
      { user_name: "Burak" },
    ]);
  });

  it("intersects requested recipients with the current shift roster", () => {
    expect(getEligiblePushSubscriptions(subscriptions, "flight-note", [" zEyNeP ", "ali"], schedule, now)).toEqual([
      { user_name: "Ali" },
    ]);
  });

  it("keeps announcements broadcast to all users", () => {
    expect(getEligiblePushSubscriptions(subscriptions, "announcement", ["Ali"], null, now)).toEqual(subscriptions);
  });

  it("fails closed when the central schedule is missing", () => {
    expect(getEligiblePushSubscriptions(subscriptions, "flight-note", undefined, null, now)).toEqual([]);
  });

  it("sends to nobody when the current schedule has no active shift", () => {
    const offShiftSchedule = {
      ...schedule,
      employees: schedule.employees.map((employee) => ({
        ...employee,
        shifts: {},
      })),
    };
    expect(getEligiblePushSubscriptions(subscriptions, "flight-note", ["Ali", "Zeynep", "Burak"], offShiftSchedule, now)).toEqual([]);
  });

  it("still targets the current shift when the caller has no recipient filter", () => {
    expect(getEligiblePushSubscriptions(subscriptions, "test", undefined, schedule, now)).toEqual([
      { user_name: "Ali" },
      { user_name: "Burak" },
    ]);
  });

  it("recognizes an overnight shift that began on the previous schedule day", () => {
    expect(getOnShiftNamesFromSchedule(schedule, now)).toContain("Burak");
  });
});
