import { supabase } from "@/integrations/supabase/client";

export interface FlightPlanEntry {
  arrivalCode: string;
  departureCode: string;
  aircraftType: string;
  tailNumber: string;
  arrivalTime: string;
  departureTime: string;
  arrivalIATA: string;
  departureIATA: string;
  parkPosition: string;
  specialNotes: string;
}

export interface FlightPlanMergeResult {
  entries: FlightPlanEntry[];
  liveWindowStartMinutes: number | null;
  liveWindowEndMinutes: number | null;
  crossesMidnight: boolean;
}

const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1-UVsf1_jZ_n_CPGqieMMWgMpbVnzzchuvexrseNUSqg/export?format=csv";

const FLIGHT_CODE_ALIASES: Record<string, string[]> = {
  PC: ["PGT"],
  PGT: ["PC"],
  TK: ["THY"],
  THY: ["TK"],
  XQ: ["SXS"],
  SXS: ["XQ"],
  VF: ["AJE"],
  AJE: ["VF"],
};

const parseCSVLine = (line: string): string[] => {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
};

export const normalizeFlightCode = (value: string) =>
  value.replace(/\s+/g, "").toUpperCase();

const parseDepartureMinutes = (value: string) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
};

const getRelativeSortMinutes = (minutes: number, pivotMinutes: number) => {
  return minutes < pivotMinutes ? minutes + 1440 : minutes;
};

const isWithinLiveWindow = (minutes: number, startMinutes: number, endMinutes: number) => {
  if (startMinutes <= endMinutes) {
    return minutes >= startMinutes && minutes <= endMinutes;
  }

  return minutes >= startMinutes || minutes <= endMinutes;
};

export const getFlightCodeMatchKeys = (value: string) => {
  const normalized = normalizeFlightCode(value);
  if (!normalized) return [];

  const keys = new Set<string>([normalized]);

  const prefixMatch = normalized.match(/^[A-Z]+/);
  const prefix = prefixMatch?.[0] || "";
  const numberPart = normalized.slice(prefix.length);

  if (numberPart) {
    keys.add(numberPart);
  }

  if (prefix && numberPart) {
    (FLIGHT_CODE_ALIASES[prefix] || []).forEach((alias) => {
      keys.add(`${alias}${numberPart}`);
    });
  }

  return Array.from(keys);
};

// Geçerli satır kontrolü: arrivalCode veya departureCode'dan biri uçuş kodu içermeli, header satırları dışlanır
const isValidRow = (arrivalCode: string, departureCode: string, fullRow: string) => {
  const isHeader = /^(ÇELEBİ|UÇUŞ|[0-9]+\.[A-Za-z])/i.test(arrivalCode);
  if (isHeader) return false;

  const hasFlightCode = /[A-Z]{2,}[0-9]+/i.test(arrivalCode) || /[A-Z]{2,}[0-9]+/i.test(departureCode);
  return hasFlightCode;
};

export const createFlightPlanPositionLookup = (
  entries: FlightPlanEntry[]
) => {
  const lookup = new Map<string, string>();

  entries.forEach((entry) => {
    [entry.departureCode, entry.arrivalCode].forEach((code) => {
      if (!code || !entry.parkPosition) return;

      getFlightCodeMatchKeys(code).forEach((key) => {
        if (!lookup.has(key)) {
          lookup.set(key, entry.parkPosition);
        }
      });
    });
  });

  return lookup;
};

export const fetchFlightPlanEntries = async () => {
  const response = await fetch(SHEET_URL);
  const text = await response.text();

  console.log("Raw CSV Data:", text);

  const lines = text.split("\n").filter(Boolean);

  if (lines.length < 2) {
    return [];
  }

  return lines
    .slice(3)
    .map((line) => {
      const cols = parseCSVLine(line);

      return {
        arrivalCode: cols[1] || "",
        departureCode: cols[2] || "",
        aircraftType: cols[3] || "",
        tailNumber: cols[4] || "",
        arrivalTime: cols[5] || "",
        departureTime: cols[6] || "",
        arrivalIATA: cols[7] || "",
        departureIATA: cols[8] || "",
        parkPosition: cols[9] || "",
        specialNotes: cols[11] || "",
      };
    })
    .filter((entry, index, array) => {
      const fullRow = JSON.stringify(entry);

      // boş satırları sil
      if (!entry.arrivalCode && !entry.departureCode) {
        console.log("FILTERED: Boş satır", entry);
        return false;
      }
      if (!isValidRow(entry.arrivalCode, entry.departureCode, fullRow)) {
        console.log("FILTERED: isValidRow başarısız", entry, fullRow);
        return false;
      }

      return true;
    });
};

export const getIstanbulDateKey = (value = new Date()) => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return formatter.format(value);
};

const isFlightPlanEntry = (value: unknown): value is FlightPlanEntry => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const entry = value as Record<string, unknown>;
  return [
    "arrivalCode",
    "departureCode",
    "aircraftType",
    "tailNumber",
    "arrivalTime",
    "departureTime",
    "arrivalIATA",
    "departureIATA",
    "parkPosition",
    "specialNotes",
  ].every((key) => typeof entry[key] === "string");
};

export const fetchFlightPlanSnapshotDates = async () => {
  const { data, error } = await supabase
    .from("flight_plan_snapshots")
    .select("snapshot_date")
    .order("snapshot_date", { ascending: false });

  if (error) {
    throw error;
  }

  return (data || []).map((row) => row.snapshot_date);
};

export const fetchFlightPlanEntriesForDate = async (snapshotDate: string) => {
  const { data, error } = await supabase
    .from("flight_plan_snapshots")
    .select("entries")
    .eq("snapshot_date", snapshotDate)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const entries = Array.isArray(data?.entries) ? data.entries.filter(isFlightPlanEntry) : [];

  if (entries.length > 0) {
    return entries;
  }

  if (snapshotDate === getIstanbulDateKey()) {
    return fetchFlightPlanEntries();
  }

  return [] as FlightPlanEntry[];
};

/**
 * Bugünün snapshot'ını (00:05'te alınan) ile canlı CSV verisini birleştirir.
 * Snapshot'taki uçuşlar korunur (Google Sheet güncellenip silinse bile),
 * şu adık hiç snapshot yoksa veya snapshot'ta bulunmayan yeni uçuşlar
 * canlı CSV'den eklenir. Böylece gün içi süreklilik sağlanır.
 */
export const fetchFlightPlanEntriesMergedWithWindow = async (): Promise<FlightPlanMergeResult> => {
  const today = getIstanbulDateKey();
  const liveEntries = await fetchFlightPlanEntries();
  const snapshotResponse = await supabase
    .from("flight_plan_snapshots")
    .select("entries")
    .eq("snapshot_date", today)
    .maybeSingle();
  const rawSnapshotEntries = snapshotResponse.error || !Array.isArray(snapshotResponse.data?.entries)
    ? []
    : snapshotResponse.data.entries;
  const snapshotResult = rawSnapshotEntries.filter(isFlightPlanEntry) as unknown as FlightPlanEntry[];

  // Bugüne ait snapshot yoksa sadece canlı veri döndür
  if (snapshotResult.length === 0) {
    return {
      entries: liveEntries,
      liveWindowStartMinutes: parseDepartureMinutes(liveEntries[0]?.departureTime || ""),
      liveWindowEndMinutes: parseDepartureMinutes(liveEntries.at(-1)?.departureTime || ""),
      crossesMidnight: false,
    };
  }

  const liveCodes = new Set(
    liveEntries
      .map((e) => normalizeFlightCode(e.departureCode || ""))
      .filter(Boolean),
  );

  const snapshotOnlyEntries = snapshotResult.filter((e) => {
    const code = normalizeFlightCode(e.departureCode || "");
    return Boolean(code) && !liveCodes.has(code);
  });

  const firstLiveMinutes = parseDepartureMinutes(liveEntries[0]?.departureTime || "");
  const lastLiveMinutes = parseDepartureMinutes(liveEntries.at(-1)?.departureTime || "");
  const crossesMidnight = firstLiveMinutes !== null && lastLiveMinutes !== null && firstLiveMinutes > lastLiveMinutes;
  const relevantSnapshotEntries = firstLiveMinutes === null || lastLiveMinutes === null
    ? snapshotOnlyEntries
    : snapshotOnlyEntries.filter((entry) => {
      const minutes = parseDepartureMinutes(entry.departureTime);
      return minutes !== null && isWithinLiveWindow(minutes, firstLiveMinutes, lastLiveMinutes);
    });

  const sortedSnapshotOnlyEntries = lastLiveMinutes === null
    ? relevantSnapshotEntries.sort((a, b) => (parseDepartureMinutes(a.departureTime) ?? 9999) - (parseDepartureMinutes(b.departureTime) ?? 9999))
    : relevantSnapshotEntries.sort((a, b) => {
      const aMinutes = parseDepartureMinutes(a.departureTime) ?? 9999;
      const bMinutes = parseDepartureMinutes(b.departureTime) ?? 9999;
      return getRelativeSortMinutes(aMinutes, lastLiveMinutes) - getRelativeSortMinutes(bMinutes, lastLiveMinutes);
    });

  // Canlı CSV akışı temel alınır; snapshot'ta olup CSV'de olmayanlar en sona eklenir.
  return {
    entries: [...liveEntries, ...sortedSnapshotOnlyEntries],
    liveWindowStartMinutes: firstLiveMinutes,
    liveWindowEndMinutes: lastLiveMinutes,
    crossesMidnight,
  };
};

export const fetchFlightPlanEntriesMerged = async (): Promise<FlightPlanEntry[]> => {
  const result = await fetchFlightPlanEntriesMergedWithWindow();
  return result.entries;
};

