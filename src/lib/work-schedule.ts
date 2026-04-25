import scheduleData from "@/data/workSchedule.json";
import { read, utils } from "xlsx";

export type Employee = {
  name: string;
  group: string;
  team: string;
  rawTeam: string;
  shifts: Record<string, string>;
};

export type SchedulePayload = {
  title: string;
  weekDates: string[];
  employees: Employee[];
};

const DEFAULT_SCHEDULE = scheduleData as SchedulePayload;
const STORAGE_KEY = "workSchedulePayload";
export const WORK_SCHEDULE_UPDATED_EVENT = "work-schedule-updated";
const DATE_COLUMNS = ["C", "D", "E", "F", "G", "H", "I"] as const;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

export const isValidSchedulePayload = (value: unknown): value is SchedulePayload => {
  if (!isRecord(value)) return false;
  if (typeof value.title !== "string") return false;
  if (!Array.isArray(value.weekDates) || value.weekDates.some((item) => typeof item !== "string")) return false;
  if (!Array.isArray(value.employees)) return false;

  return value.employees.every((employee) => {
    if (!isRecord(employee)) return false;
    if (typeof employee.name !== "string") return false;
    if (typeof employee.group !== "string") return false;
    if (typeof employee.team !== "string") return false;
    if (typeof employee.rawTeam !== "string") return false;
    if (!isRecord(employee.shifts)) return false;
    return Object.values(employee.shifts).every((shift) => typeof shift === "string");
  });
};

export const getDefaultSchedulePayload = () => DEFAULT_SCHEDULE;

export const getStoredSchedulePayload = () => {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) return DEFAULT_SCHEDULE;

  try {
    const parsed: unknown = JSON.parse(stored);
    return isValidSchedulePayload(parsed) ? parsed : DEFAULT_SCHEDULE;
  } catch {
    return DEFAULT_SCHEDULE;
  }
};

export const saveSchedulePayload = (payload: SchedulePayload) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  window.dispatchEvent(new CustomEvent(WORK_SCHEDULE_UPDATED_EVENT, { detail: payload }));
};

export const clearStoredSchedulePayload = () => {
  window.localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(WORK_SCHEDULE_UPDATED_EVENT, { detail: DEFAULT_SCHEDULE }));
};

export const hasStoredSchedulePayload = () => Boolean(window.localStorage.getItem(STORAGE_KEY));

const excelDateToIso = (value: unknown) => {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const base = new Date(Date.UTC(1899, 11, 30));
    base.setUTCDate(base.getUTCDate() + Math.floor(value));
    return base.toISOString().slice(0, 10);
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      return normalized;
    }

    const date = new Date(normalized);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString().slice(0, 10);
    }
  }

  throw new Error("Excel tarih kolonu okunamadi");
};

const parseTeam = (rawValue: string) => {
  const normalized = rawValue.trim();
  const match = normalized.match(/^Group:\s*(.*?)\s*--\s*Team:\s*(.*)$/);
  if (!match) {
    return { group: "", team: normalized };
  }

  return {
    group: match[1].trim(),
    team: match[2].trim(),
  };
};

const buildSchedulePayload = (rows: Record<string, unknown>[]) => {
  if (!rows.length) {
    throw new Error("Excel dosyasi bos veya okunamadi");
  }

  const header = rows[0] || {};
  const availableDateColumns = DATE_COLUMNS.filter((column) => header[column] !== undefined && header[column] !== "");
  const weekDates = availableDateColumns.map((column) => excelDateToIso(header[column]));

  if (!weekDates.length) {
    throw new Error("Excel dosyasinda hafta tarihleri bulunamadi");
  }

  const employees: Employee[] = rows.slice(1).flatMap((row) => {
    const name = String(row.A || "").trim();
    const rawTeam = String(row.B || "").trim();
    if (!name || !rawTeam) {
      return [];
    }

    const { group, team } = parseTeam(rawTeam);
    const shifts = Object.fromEntries(
      availableDateColumns.map((column, index) => [weekDates[index], String(row[column] || "").trim()]),
    );

    return [{
      name,
      group,
      team,
      rawTeam,
      shifts,
    }];
  });

  return {
    title: String(header.A || "").trim(),
    weekDates,
    employees,
  } satisfies SchedulePayload;
};

export const parseScheduleWorkbook = async (file: File) => {
  const buffer = await file.arrayBuffer();
  const workbook = read(buffer, { type: "array", cellDates: true });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    throw new Error("Excel dosyasinda sayfa bulunamadi");
  }

  const worksheet = workbook.Sheets[firstSheetName];
  const rows = utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    header: "A",
    raw: true,
    defval: "",
  });

  return buildSchedulePayload(rows);
};