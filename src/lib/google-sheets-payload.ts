import { getFlightCodeMatchKeys, normalizeFlightCode } from "@/lib/flight-plan";
import type { GoogleSheetsSyncPayload } from "@/lib/google-sheets-sync";
import { extractAssignedStaffFromService, getVisibleServiceNotes } from "@/lib/wheelchair-service-utils";

type FlightPlanLike = {
  departureCode: string;
  departureTime: string;
  departureIATA: string;
  parkPosition: string;
  tailNumber?: string;
  specialNotes?: string;
};

type ServiceLike = {
  created_at: string;
  flight_iata: string | null;
  terminal: string | null;
  passenger_type: string | null;
  assigned_staff?: string | null;
  created_by: string | null;
  wheelchair_id: string | null;
  notes?: string | null;
};

type WheelchairInventoryLike = {
  terminal: string | null;
  status: string | null;
};

type HandoverLogLike = {
  created_at: string;
  details?: string | null;
  performed_by?: string | null;
};

export const extractAirlineCodeFromFlightCode = (value: string) => {
  const match = normalizeFlightCode(value).match(/^[A-Z0-9]+?(?=\d|$)/);
  return match?.[0] || "";
};

export const buildFlightLookup = <TFlight extends FlightPlanLike>(flightPlanEntries: TFlight[]) => {
  const flightLookup = new Map<string, TFlight>();

  flightPlanEntries
    .filter((entry) => Boolean(entry.departureCode))
    .forEach((entry) => {
      getFlightCodeMatchKeys(entry.departureCode).forEach((key) => {
        if (!flightLookup.has(key)) {
          flightLookup.set(key, entry);
        }
      });
    });

  return flightLookup;
};

const buildDepartureWheelchairCountMap = <TFlight extends FlightPlanLike, TService extends ServiceLike>(
  flightLookup: Map<string, TFlight>,
  services: TService[]
) => {
  const counts = new Map<string, number>();

  services.forEach((service) => {
    const matchedEntry = getFlightCodeMatchKeys(service.flight_iata || "")
      .map((key) => flightLookup.get(key))
      .find(Boolean);
    const flightCode = normalizeFlightCode(matchedEntry?.departureCode || service.flight_iata || "");

    if (!flightCode) {
      return;
    }

    counts.set(flightCode, (counts.get(flightCode) || 0) + 1);
  });

  return counts;
};

export const buildDeparturesPayload = <TFlight extends FlightPlanLike, TService extends ServiceLike>(
  flightPlanEntries: TFlight[],
  services: TService[]
): GoogleSheetsSyncPayload["departures"] => {
  const departureEntries = flightPlanEntries.filter((entry) => Boolean(entry.departureCode));
  const flightLookup = buildFlightLookup(departureEntries);
  const wheelchairCounts = buildDepartureWheelchairCountMap(flightLookup, services);

  return departureEntries.map((entry) => ({
    updatedAt: new Date().toISOString(),
    departureTime: entry.departureTime || "",
    airline: extractAirlineCodeFromFlightCode(entry.departureCode),
    flightCode: normalizeFlightCode(entry.departureCode),
    tailCode: (entry.tailNumber || "").trim(),
    destination: entry.departureIATA || "",
    terminal: "",
    gate: entry.parkPosition || "",
    status: entry.specialNotes ? "noted" : "scheduled",
    delayMinutes: 0,
    wheelchairCount: wheelchairCounts.get(normalizeFlightCode(entry.departureCode)) || 0,
  }));
};

export const buildSpecialServicesPayload = <TFlight extends FlightPlanLike, TService extends ServiceLike>(
  flightLookup: Map<string, TFlight>,
  services: TService[]
): GoogleSheetsSyncPayload["specialServices"] => {
  return services.map((service) => {
    const matchedEntry = getFlightCodeMatchKeys(service.flight_iata || "")
      .map((key) => flightLookup.get(key))
      .find(Boolean);

    return {
      createdAt: service.created_at,
      flightCode: normalizeFlightCode(service.flight_iata || ""),
      airline: matchedEntry
        ? extractAirlineCodeFromFlightCode(matchedEntry.departureCode)
        : extractAirlineCodeFromFlightCode(service.flight_iata || ""),
      destination: matchedEntry?.departureIATA || "",
      terminal: service.terminal || "",
      gate: matchedEntry?.parkPosition || "",
      passengerType: service.passenger_type || "",
      assignedStaff: extractAssignedStaffFromService(service.notes) || service.assigned_staff || "",
      createdBy: service.created_by || "",
      wheelchairId: service.wheelchair_id || "",
      specialNotes: getVisibleServiceNotes(service.notes) || "-",
    };
  });
};

export const buildInventorySummaryPayload = <TWheelchair extends WheelchairInventoryLike>(
  wheelchairRows: TWheelchair[]
): GoogleSheetsSyncPayload["inventorySummary"] => {
  const inventoryByTerminal = new Map<string, { available: number; missing: number; maintenance: number }>();

  wheelchairRows.forEach((row) => {
    const terminal = (row.terminal || "GENEL").trim() || "GENEL";
    const current = inventoryByTerminal.get(terminal) || { available: 0, missing: 0, maintenance: 0 };

    if (row.status === "missing") {
      current.missing += 1;
    } else if (row.status === "maintenance") {
      current.maintenance += 1;
    } else {
      current.available += 1;
    }

    inventoryByTerminal.set(terminal, current);
  });

  return Array.from(inventoryByTerminal.entries())
    .sort((left, right) => left[0].localeCompare(right[0], "tr"))
    .map(([terminal, counts]) => ({
      updatedAt: new Date().toISOString(),
      terminal,
      available: counts.available,
      missing: counts.missing,
      maintenance: counts.maintenance,
    }));
};

const splitChecklistSegments = (segments: string[]) => {
  return segments
    .flatMap((segment) => segment.split(/,\s*(?=(?:Sayim|Ofis|Aksaklik|Not):)/))
    .map((segment) => segment.trim())
    .filter(Boolean);
};

export const parseHandoverDetails = (details?: string | null, performedBy?: string | null) => {
  const segments = (details || "")
    .split(" | ")
    .map((segment) => segment.trim())
    .filter(Boolean);

  const transitionPart = segments.shift() || "";
  const transitionMatch = transitionPart.match(/^(.*?) → (.*?) \((.*?)\)$/);
  const snapshot = segments.shift() || "";

  if (segments[0]?.startsWith("Notlu:")) {
    segments.shift();
  }

  const checklistSegments = splitChecklistSegments(segments);
  const wheelchairCountStatus = checklistSegments.find((segment) => segment.startsWith("Sayim:"));
  const officeStatus = checklistSegments.find((segment) => segment.startsWith("Ofis:"));
  const noteSegment = checklistSegments.find((segment) => segment.startsWith("Aksaklik:") || segment.startsWith("Not:"));
  const noteValue = noteSegment ? noteSegment.replace(/^(?:Aksaklik|Not):\s*/i, "").trim() : "";
  const checklist = [wheelchairCountStatus, officeStatus]
    .filter(Boolean)
    .concat(noteValue && noteValue.toLocaleLowerCase("tr") !== "yok" ? [`Not: ${noteValue}`] : [])
    .join(" • ") || "Checklist bilgisi yok";

  return {
    terminal: transitionMatch?.[3] || "",
    fromStaff: transitionMatch?.[1] || performedBy || "",
    toStaff: transitionMatch?.[2] || "",
    snapshot: snapshot || "Kayit yok",
    checklist,
  };
};

export const buildHandoversPayload = <THandover extends HandoverLogLike>(
  handoverLogs: THandover[]
): GoogleSheetsSyncPayload["handovers"] => {
  return handoverLogs.map((log) => ({
    createdAt: log.created_at,
    ...parseHandoverDetails(log.details, log.performed_by),
  }));
};