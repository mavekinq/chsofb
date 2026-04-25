import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type ServiceTerminalCode = "T1" | "T2";
export type AirlineTerminalRuleRow = Tables<"airline_terminal_rules">;
export type AirlineTerminalRule = Pick<AirlineTerminalRuleRow, "airline_code" | "terminal_code" | "is_active" | "note">;
export type AirlineTerminalRulesSource = "database" | "local" | "fallback";

const DEFAULT_AIRLINE_TERMINAL_RULES: AirlineTerminalRule[] = [
  { airline_code: "PC", terminal_code: "T1", is_active: true, note: "Pegasus ic hat/T1 eslemesi" },
  { airline_code: "4M", terminal_code: "T2", is_active: true, note: "Varsayilan T2 havayolu" },
  { airline_code: "KC", terminal_code: "T2", is_active: true, note: "Varsayilan T2 havayolu" },
  { airline_code: "TB", terminal_code: "T2", is_active: true, note: "Varsayilan T2 havayolu" },
  { airline_code: "W9", terminal_code: "T2", is_active: true, note: "Varsayilan T2 havayolu" },
  { airline_code: "BY", terminal_code: "T2", is_active: true, note: "Varsayilan T2 havayolu" },
  { airline_code: "OR", terminal_code: "T2", is_active: true, note: "Varsayilan T2 havayolu" },
  { airline_code: "OL", terminal_code: "T2", is_active: true, note: "Varsayilan T2 havayolu" },
  { airline_code: "B2", terminal_code: "T2", is_active: true, note: "Yeni eklenen T2 havayolu" },
];

const AIRLINE_TERMINAL_RULES_STORAGE_KEY = "airlineTerminalRules";

const normalizeCode = (value?: string | null) => (value || "").toString().toUpperCase().trim();

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const isAirlineTerminalRule = (value: unknown): value is AirlineTerminalRule => {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.airline_code === "string"
    && (value.terminal_code === "T1" || value.terminal_code === "T2")
    && typeof value.is_active === "boolean"
    && (typeof value.note === "string" || value.note === null);
};

export const isAirlineTerminalRulesTableMissing = (error: unknown) => {
  if (!isRecord(error)) {
    return false;
  }

  return error.code === "PGRST205"
    || (typeof error.message === "string" && error.message.includes("public.airline_terminal_rules"));
};

export const readStoredAirlineTerminalRules = () => {
  if (typeof window === "undefined") {
    return getDefaultAirlineTerminalRules();
  }

  const stored = window.localStorage.getItem(AIRLINE_TERMINAL_RULES_STORAGE_KEY);
  if (!stored) {
    return getDefaultAirlineTerminalRules();
  }

  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      return getDefaultAirlineTerminalRules();
    }

    const rules = parsed.filter(isAirlineTerminalRule);
    return rules.length > 0 ? rules : getDefaultAirlineTerminalRules();
  } catch {
    return getDefaultAirlineTerminalRules();
  }
};

export const saveStoredAirlineTerminalRules = (rules: AirlineTerminalRule[]) => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(AIRLINE_TERMINAL_RULES_STORAGE_KEY, JSON.stringify(rules));
};

export const getDefaultAirlineTerminalRules = () => DEFAULT_AIRLINE_TERMINAL_RULES;

export const fetchAirlineTerminalRules = async () => {
  const { data, error } = await supabase
    .from("airline_terminal_rules")
    .select("airline_code, terminal_code, is_active, note")
    .eq("is_active", true)
    .order("airline_code", { ascending: true });

  if (isAirlineTerminalRulesTableMissing(error)) {
    return {
      rules: readStoredAirlineTerminalRules(),
      source: "local" as const,
      error,
    };
  }

  if (error || !data || data.length === 0) {
    return {
      rules: getDefaultAirlineTerminalRules(),
      source: "fallback" as const,
      error,
    };
  }

  return {
    rules: data as AirlineTerminalRule[],
    source: "database" as const,
    error: null,
  };
};

export const resolveServiceFlightTerminal = (
  airlineIata?: string | null,
  departureTerminal?: string | null,
  rules: AirlineTerminalRule[] = DEFAULT_AIRLINE_TERMINAL_RULES,
): ServiceTerminalCode | null => {
  const normalizedAirlineCode = normalizeCode(airlineIata);
  const normalizedDepartureTerminal = normalizeCode(departureTerminal);

  // PC has operations on both T1 and T2. Resolve by actual departure terminal.
  if (normalizedAirlineCode === "PC") {
    if (normalizedDepartureTerminal === "T1" || normalizedDepartureTerminal === "1") {
      return "T1";
    }
    if (normalizedDepartureTerminal === "T2" || normalizedDepartureTerminal === "2") {
      return "T2";
    }
  }

  const matchedRule = rules.find((rule) => normalizeCode(rule.airline_code) === normalizedAirlineCode && rule.is_active);

  if ((normalizedDepartureTerminal === "T2" || normalizedDepartureTerminal === "2") && matchedRule?.terminal_code === "T2") {
    return "T2";
  }

  if ((normalizedDepartureTerminal === "T1" || normalizedDepartureTerminal === "1") && matchedRule?.terminal_code === "T1") {
    return "T1";
  }

  return null;
};
