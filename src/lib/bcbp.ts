export type BcbpData = {
  passengerName: string | null;
  pnr: string | null;
  origin: string | null;
  destination: string | null;
  airline: string | null;
  flightNumber: string | null;
  flightDate: string | null;
  cabinClass: string | null;
  seat: string | null;
  sequenceNumber: string | null;
  boardingTime: string | null;
  baggageAllowance: string | null;
  rawValue: string;
};

const EMPTY_BCBP: Omit<BcbpData, "rawValue"> = {
  passengerName: null,
  pnr: null,
  origin: null,
  destination: null,
  airline: null,
  flightNumber: null,
  flightDate: null,
  cabinClass: null,
  seat: null,
  sequenceNumber: null,
  boardingTime: null,
  baggageAllowance: null,
};

const cleanField = (value: string) => value.replace(/<+$/g, "").trim() || null;

const parsePassengerName = (value: string) => {
  const normalized = value.replace(/<+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return null;

  const [surname, ...givenNames] = normalized.split("/");
  return givenNames.length > 0
    ? `${givenNames.join(" ").trim()} ${surname.trim()}`.trim()
    : normalized;
};

const getJulianDate = (value: string) => {
  if (!/^\d{3}$/.test(value)) return null;

  const dayOfYear = Number(value);
  const now = new Date();
  const candidates = [-1, 0, 1].map((yearOffset) => {
    const year = now.getFullYear() + yearOffset;
    const date = new Date(year, 0, dayOfYear);
    return {
      date,
      distance: Math.abs(date.getTime() - now.getTime()),
    };
  });
  const closest = candidates.sort((a, b) => a.distance - b.distance)[0]?.date;
  return closest
    ? `${closest.getFullYear()}-${String(closest.getMonth() + 1).padStart(2, "0")}-${String(closest.getDate()).padStart(2, "0")}`
    : null;
};

const parseOptionalData = (value: string) => {
  const normalized = value.replace(/</g, " ").replace(/\s+/g, " ").trim();
  const boardingMatch = normalized.match(/(?:BOARDING|BOARD|BT)\s*[:/-]?\s*([01]\d|2[0-3])([0-5]\d)\b/i);
  const baggageMatch = normalized.match(/(?:BAGGAGE|BAG|ALLOWANCE|ALLOW)\s*[:/-]?\s*(\d{1,2})\s*(KG|KILOGRAMS?|LB|LBS)\b/i)
    || normalized.match(/\b(\d{1,2})\s*(KG|KILOGRAMS?|LB|LBS)\b/i);

  return {
    boardingTime: boardingMatch ? `${boardingMatch[1]}:${boardingMatch[2]}` : null,
    baggageAllowance: baggageMatch ? `${baggageMatch[1]} ${baggageMatch[2].toUpperCase()}` : null,
  };
};

export const parseBCBP = (rawValue: string): BcbpData => {
  const raw = String(rawValue || "");
  const value = raw.replace(/^(?:PDF_417|AZTEC|DATA_MATRIX)\s*:\s*/i, "").replace(/[\r\n]/g, "");

  if (value.length < 60 || !/^[A-Z]\d/.test(value)) {
    return { ...EMPTY_BCBP, rawValue: raw };
  }

  const optional = parseOptionalData(value.slice(60));
  return {
    passengerName: parsePassengerName(value.slice(2, 22)),
    pnr: cleanField(value.slice(23, 30)),
    origin: cleanField(value.slice(30, 33)),
    destination: cleanField(value.slice(33, 36)),
    airline: cleanField(value.slice(36, 39)),
    flightNumber: cleanField(value.slice(39, 44)),
    flightDate: getJulianDate(value.slice(44, 47)),
    cabinClass: cleanField(value.slice(47, 48)),
    seat: cleanField(value.slice(48, 52)),
    sequenceNumber: cleanField(value.slice(52, 57)),
    ...optional,
    rawValue: raw,
  };
};

export const isBcbpData = (value: BcbpData) =>
  Boolean(value.origin && value.destination && value.airline && value.flightNumber);
