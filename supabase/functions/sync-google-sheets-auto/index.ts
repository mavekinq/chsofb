import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type FlightPlanEntry = {
  departureCode: string;
  departureTime: string;
  departureIATA: string;
  parkPosition: string;
  specialNotes?: string;
};

type ServiceRow = {
  created_at: string;
  flight_iata: string | null;
  terminal: string | null;
  passenger_type: string | null;
  assigned_staff?: string | null;
  created_by: string | null;
  wheelchair_id: string | null;
  notes?: string | null;
};

type WheelchairRow = {
  terminal: string | null;
  status: string | null;
};

type HandoverLogRow = {
  created_at: string;
  details: string | null;
  performed_by: string | null;
};

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

const extractAirlineCodeFromFlightCode = (value: string) => {
  const match = (value || "").trim().toUpperCase().replace(/\s+/g, "").match(/^[A-Z0-9]+?(?=\d|$)/);
  return match?.[0] || "";
};

const normalizeFlightCode = (value: string) => {
  return (value || "").trim().toUpperCase().replace(/\s+/g, "");
};

const getFlightCodeMatchKeys = (flightCode: string) => {
  const normalized = normalizeFlightCode(flightCode);
  if (!normalized) {
    return [] as string[];
  }

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

const parseCSVLine = (line: string): string[] => {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
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

const fetchFlightPlanEntries = async () => {
  const response = await fetch(`${SHEET_URL}&_t=${Date.now()}`, {
    headers: { "Cache-Control": "no-cache" },
  });

  if (!response.ok) {
    throw new Error(`Flight source fetch failed: ${response.status}`);
  }

  const text = await response.text();
  const lines = text.split("\n").filter(Boolean);
  if (lines.length < 4) {
    return [] as FlightPlanEntry[];
  }

  return lines
    .slice(3)
    .map((line) => {
      const cols = parseCSVLine(line);
      return {
        departureCode: cols[2] || "",
        departureTime: cols[6] || "",
        departureIATA: cols[8] || "",
        parkPosition: cols[9] || "",
        specialNotes: cols[11] || "",
      } satisfies FlightPlanEntry;
    })
    .filter((entry) => entry.departureCode || entry.departureIATA);
};

const getVisibleServiceNotes = (notes?: string | null) => {
  const normalizedNotes = (notes || "").trim();
  const prefix = "__ASSIGNED_STAFF__:";
  if (!normalizedNotes.startsWith(prefix)) {
    return normalizedNotes;
  }
  const [, ...remainingLines] = normalizedNotes.split(/\r?\n/);
  return remainingLines.join("\n").trim();
};

const extractAssignedStaffFromService = (notes?: string | null) => {
  const normalizedNotes = (notes || "").trim();
  const prefix = "__ASSIGNED_STAFF__:";
  if (!normalizedNotes.startsWith(prefix)) {
    return "";
  }
  const firstLine = normalizedNotes.split(/\r?\n/, 1)[0] || "";
  return firstLine.slice(prefix.length).trim();
};

const translatePassengerType = (value: string | null) => {
  const normalized = (value || "").trim().toUpperCase();
  const map: Record<string, string> = {
    STEP: "Merdiven",
    RAMP: "Rampa",
    CABIN: "Kabin",
  };
  return map[normalized] || (value || "");
};

const splitDateTimeParts = (value: string, timezone: string) => {
  const fallback = new Date();
  const date = new Date(value || fallback);

  if (Number.isNaN(date.getTime())) {
    const raw = (value || "").trim();
    if (!raw) {
      return ["", ""];
    }
    const parts = raw.split(" ");
    return [parts[0] || "", parts[1] || ""];
  }

  const formatter = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: timezone,
  });

  const parts = formatter.formatToParts(date);
  const dateParts = parts
    .filter(p => ["year", "month", "day"].includes(p.type))
    .map(p => p.value)
    .join("-");
  const timeParts = parts
    .filter(p => ["hour", "minute", "second"].includes(p.type))
    .map(p => p.value)
    .join(":");

  return [dateParts, timeParts];
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const syncUrl = Deno.env.get("GOOGLE_SHEETS_SYNC_URL") || "";
    const syncToken = Deno.env.get("GOOGLE_SHEETS_SYNC_TOKEN") || "";
    const timezone = "Europe/Istanbul";

    if (!supabaseUrl || !supabaseServiceRoleKey || !syncUrl) {
      throw new Error("Missing required environment variables");
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ success: false, error: "Only POST is supported" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

    const [
      flightPlans,
      { data: serviceRows, error: serviceError },
      { data: wheelchairRows, error: wheelchairError },
      { data: handoverLogs, error: handoverError },
    ] = await Promise.all([
      fetchFlightPlanEntries(),
      supabaseAdmin
        .from("wheelchair_services")
        .select("*")
        .gte("created_at", todayStart)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("wheelchairs")
        .select("terminal, status"),
      supabaseAdmin
        .from("action_logs")
        .select("created_at, details, performed_by")
        .eq("action", "Vardiya Devri")
        .gte("created_at", todayStart)
        .order("created_at", { ascending: false }),
    ]);

    if (serviceError || wheelchairError || handoverError) {
      throw serviceError || wheelchairError || handoverError;
    }

    const flightLookup = new Map<string, FlightPlanEntry>();
    (flightPlans || []).forEach((entry: FlightPlanEntry) => {
      getFlightCodeMatchKeys(entry.departureCode).forEach((key) => {
        if (!flightLookup.has(key)) {
          flightLookup.set(key, entry);
        }
      });
    });

    const departures = (flightPlans || [])
      .map((entry: FlightPlanEntry) => ({
        departureTime: entry.departureTime || "",
        airline: extractAirlineCodeFromFlightCode(entry.departureCode),
        flightCode: normalizeFlightCode(entry.departureCode),
        destination: entry.departureIATA || "",
        gate: entry.parkPosition || "",
        plannedPosition: entry.parkPosition || "",
      }))
      .filter((row: { destination: string }) => row.destination !== "");

    const specialServices = (serviceRows || [])
      .map((service: ServiceRow) => {
        const visibleNotes = getVisibleServiceNotes(service.notes);
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
          specialNotes: visibleNotes || "-",
        };
      });

    const inventoryByTerminal = new Map<string, { available: number; missing: number; maintenance: number }>();
    (wheelchairRows || []).forEach((row: WheelchairRow) => {
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

    const inventorySummary = Array.from(inventoryByTerminal.entries())
      .sort((left, right) => left[0].localeCompare(right[0], "tr"))
      .map(([terminal, counts]) => ({
        updatedAt: new Date().toISOString(),
        terminal,
        available: counts.available,
        missing: counts.missing,
        maintenance: counts.maintenance,
      }));

    const handovers = (handoverLogs || []).map((log: HandoverLogRow) => {
      const details = log.details || "";
      const [transitionPart = "", snapshot = "", checklist = ""] = details.split(" | ");
      const transitionMatch = transitionPart.match(/^(.*?) → (.*?) \((.*?)\)$/);

      return {
        createdAt: log.created_at,
        terminal: transitionMatch?.[3] || "",
        fromStaff: transitionMatch?.[1] || log.performed_by || "",
        toStaff: transitionMatch?.[2] || "",
        snapshot: snapshot || "",
        checklist: checklist || "",
      };
    });

    const payload = {
      departures,
      specialServices,
      inventorySummary,
      handovers,
    };

    const targetUrl = syncToken
      ? `${syncUrl}${syncUrl.includes("?") ? "&" : "?"}token=${encodeURIComponent(syncToken)}`
      : syncUrl;

    const upstreamResponse = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const responseText = await upstreamResponse.text();
    let upstreamJson: unknown = responseText;

    try {
      upstreamJson = responseText ? JSON.parse(responseText) : null;
    } catch {
      upstreamJson = responseText;
    }

    if (!upstreamResponse.ok) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Google Sheets endpoint error",
          upstreamStatus: upstreamResponse.status,
          upstream: upstreamJson,
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        upstreamStatus: upstreamResponse.status,
        upstream: upstreamJson,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
