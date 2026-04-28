import { createClient } from "jsr:@supabase/supabase-js@2";

type FlightPlanEntry = {
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
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1-UVsf1_jZ_n_CPGqieMMWgMpbVnzzchuvexrseNUSqg/export?format=csv";

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

const isValidRow = (arrivalCode: string, departureCode: string) => {
  const isHeader = /^(ÇELEBİ|UÇUŞ|[0-9]+\.[A-Za-z])/i.test(arrivalCode);
  if (isHeader) return false;

  return /[A-Z]{2,}[0-9]+/i.test(arrivalCode) || /[A-Z]{2,}[0-9]+/i.test(departureCode);
};

const parseFlightPlanEntries = (text: string): FlightPlanEntry[] => {
  const lines = text.split("\n").filter(Boolean);
  if (lines.length < 4) {
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
      } satisfies FlightPlanEntry;
    })
    .filter((entry) => {
      if (!entry.arrivalCode && !entry.departureCode) {
        return false;
      }

      return isValidRow(entry.arrivalCode, entry.departureCode);
    });
};

const getIstanbulDateKey = (value = new Date()) => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return formatter.format(value);
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ success: false, error: "Only POST is supported" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing Supabase environment variables");
    }

    const response = await fetch(`${SHEET_URL}&_t=${Date.now()}`, {
      headers: { "Cache-Control": "no-cache" },
    });

    if (!response.ok) {
      throw new Error(`Flight source fetch failed: ${response.status}`);
    }

    const rawCsv = await response.text();
    const entries = parseFlightPlanEntries(rawCsv);
    const snapshotDate = getIstanbulDateKey();
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const { error } = await supabaseAdmin
      .from("flight_plan_snapshots")
      .upsert({
        snapshot_date: snapshotDate,
        source_fetched_at: new Date().toISOString(),
        entries,
        raw_csv: rawCsv,
      }, { onConflict: "snapshot_date" });

    if (error) {
      throw error;
    }

    return new Response(JSON.stringify({ success: true, snapshotDate, rowCount: entries.length }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
