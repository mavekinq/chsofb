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

// 🔥 A sütunu + nokta filtresi
const isValidRow = (arrivalCode: string, fullRow: string) => {
  const hasNumber = /\d/.test(arrivalCode); // A sütunu sayı kontrolü
  const hasDot = fullRow.includes(".");      // satırda nokta var mı?

  return hasNumber && !hasDot;
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
      if (!entry.arrivalCode && !entry.departureCode) return false;

      // 🔥 SENİN KURAL
      if (!isValidRow(entry.arrivalCode, fullRow)) {
        // console.log("FILTERED:", entry);
        return false;
      }

      return true;
    });
};