import scheduleData from "@/data/workSchedule.json";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
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
const REMOTE_TABLE = "work_schedule_state";
const REMOTE_ROW_ID = "global";
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

export const isCustomSchedulePayload = (payload: SchedulePayload) => {
  return JSON.stringify(payload) !== JSON.stringify(DEFAULT_SCHEDULE);
};

const isWorkScheduleTableMissing = (error: unknown) => {
  if (!isRecord(error)) {
    return false;
  }

  return error.code === "PGRST205"
    || (typeof error.message === "string" && error.message.includes("work_schedule_state"));
};

const writeLocalSchedulePayload = (payload: SchedulePayload) => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
};

const dispatchScheduleUpdated = (payload: SchedulePayload) => {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(WORK_SCHEDULE_UPDATED_EVENT, { detail: payload }));
};

export const getStoredSchedulePayload = () => {
  if (typeof window === "undefined") {
    return DEFAULT_SCHEDULE;
  }

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) return DEFAULT_SCHEDULE;

  try {
    const parsed: unknown = JSON.parse(stored);
    return isValidSchedulePayload(parsed) ? parsed : DEFAULT_SCHEDULE;
  } catch {
    return DEFAULT_SCHEDULE;
  }
};

export const loadSchedulePayload = async () => {
  const localPayload = getStoredSchedulePayload();

  try {
    const { data, error } = await supabase
      .from(REMOTE_TABLE)
      .select("payload")
      .eq("id", REMOTE_ROW_ID)
      .maybeSingle();

    if (error) {
      if (!isWorkScheduleTableMissing(error)) {
        console.error("Central schedule fetch failed:", error);
      }
      return localPayload;
    }

    if (!data || !isRecord(data) || !isValidSchedulePayload(data.payload)) {
      return localPayload;
    }

    const remotePayload = data.payload;
    writeLocalSchedulePayload(remotePayload);
    dispatchScheduleUpdated(remotePayload);
    return remotePayload;
  } catch (error) {
    console.error("Central schedule fetch failed:", error);
    return localPayload;
  }
};

export const saveSchedulePayload = async (payload: SchedulePayload) => {
  writeLocalSchedulePayload(payload);
  dispatchScheduleUpdated(payload);

  const { error } = await supabase
    .from(REMOTE_TABLE)
    .upsert({
      id: REMOTE_ROW_ID,
      payload: payload as unknown as Json,
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });

  if (error) {
    throw error;
  }
};

export const clearStoredSchedulePayload = async () => {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(STORAGE_KEY);
  }

  dispatchScheduleUpdated(DEFAULT_SCHEDULE);

  const { error } = await supabase
    .from(REMOTE_TABLE)
    .upsert({
      id: REMOTE_ROW_ID,
      payload: DEFAULT_SCHEDULE as unknown as Json,
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });

  if (error) {
    throw error;
  }
};

export const hasStoredSchedulePayload = () => {
  if (typeof window === "undefined") {
    return false;
  }

  return Boolean(window.localStorage.getItem(STORAGE_KEY));
};

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

const excelDateToIso = (value: unknown) => {
  if (value instanceof Date) {
    // Add 12 hours (midday) before extracting the UTC date to guard against
    // sub-minute timezone offsets (e.g. Istanbul's historical +2:56:56) that
    // place the Date a few seconds before local midnight, which would cause
    // getDate() / getUTCDate() to return the previous day.
    const midday = new Date(value.getTime() + TWELVE_HOURS_MS);
    return midday.toISOString().slice(0, 10);
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
  const workbook = read(buffer, { type: "array" });
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

const SHIFT_PATTERN = /^(\d{2})(\d{2})-(\d{2})(\d{2})$/;

const parseShiftMinutes = (value: string) => {
  const normalized = (value || "").trim().replace(/\s+/g, "");
  const match = normalized.match(SHIFT_PATTERN);
  if (!match) return null;
  const start = Number(match[1]) * 60 + Number(match[2]);
  const end = Number(match[3]) * 60 + Number(match[4]);
  return { start, end, overnight: end <= start };
};

const isShiftActiveNow = (shiftValue: string, minuteNow: number) => {
  const parsed = parseShiftMinutes(shiftValue);
  if (!parsed) return false;
  if (!parsed.overnight) return minuteNow >= parsed.start && minuteNow < parsed.end;
  return minuteNow >= parsed.start || minuteNow < parsed.end;
};

const isOvernightFromPrevDay = (shiftValue: string, minuteNow: number) => {
  const parsed = parseShiftMinutes(shiftValue);
  if (!parsed || !parsed.overnight) return false;
  return minuteNow < parsed.end;
};

/**
 * Returns the names of employees currently on shift according to the stored schedule.
 * Pass these names to the push notification payload so only on-shift staff receive alerts.
 */
export const getOnShiftUserNames = (): string[] => {
  const payload = getStoredSchedulePayload();
  const now = new Date();
  const minuteNow = now.getHours() * 60 + now.getMinutes();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const todayIndex = payload.weekDates.indexOf(todayKey);
  if (todayIndex === -1) return [];
  const previousDayKey = todayIndex > 0 ? payload.weekDates[todayIndex - 1] : null;

  return payload.employees
    .filter((employee) => {
      const todayShift = employee.shifts[todayKey] || "";
      const previousShift = previousDayKey ? employee.shifts[previousDayKey] || "" : "";
      return isShiftActiveNow(todayShift, minuteNow)
        || (previousDayKey ? isOvernightFromPrevDay(previousShift, minuteNow) : false);
    })
    .map((employee) => employee.name);
};