const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MORE_EVENT_TARGET = "ctl00$ctl00$ContentPlaceHolder_ForNested$ContentPlaceHolder_ForNested$LinkButton_More";
const FLIGHT_SOURCE_URLS = {
  international: "https://www.antalya-airport.aero/yolcu-ve-ziyaretciler/ucus-bilgileri/dis-hat-gidis",
  domestic: "https://www.antalya-airport.aero/yolcu-ve-ziyaretciler/ucus-bilgileri/yurtici-gidis",
} as const;

type FlightSourceKey = keyof typeof FLIGHT_SOURCE_URLS;

const resolveSourceKey = (value: unknown): FlightSourceKey => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "domestic") return "domestic";
  return "international";
};

const getInputValue = (html: string, fieldId: string, fieldName = fieldId) => {
  const regex = new RegExp(
    `name=\"${fieldName.replace(/[$]/g, "\\$")}\" id=\"${fieldId.replace(/[$]/g, "\\$")}\" value=\"([\\s\\S]*?)\"`,
    "i",
  );
  return regex.exec(html)?.[1] || "";
};

const countRows = (html: string) => {
  const matches = html.match(/<tr class=\"status_/g);
  return matches?.length || 0;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getFlightGate = async (flightId: string): Promise<string | null> => {
  const detailUrl = new URL("https://antalyamobilemodules.antalya-airport.aero/ModulesApi/GetFlightDetail");
  detailUrl.searchParams.set("airportName", "Antalya_FlightsDB");
  detailUrl.searchParams.set("FLIGHT_ID", flightId);

  const response = await fetch(detailUrl, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!response.ok) {
    throw new Error(`Flight detail request failed for ${flightId}: ${response.status}`);
  }

  const result: unknown = await response.json();
  if (!isRecord(result) || result.Success !== true) {
    throw new Error(`Flight detail response was unsuccessful for ${flightId}`);
  }

  const data = typeof result.data === "string" ? JSON.parse(result.data) as unknown : result.data;
  if (!Array.isArray(data)) {
    throw new Error(`Flight detail response had an invalid data shape for ${flightId}`);
  }

  const flight = data.find(isRecord);
  const gate = flight?.GATE;
  return typeof gate === "string" && gate.trim() ? gate.trim() : null;
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
    const payload = await request.json().catch(() => ({}));
    const requestBody = payload as { mode?: unknown; flightIds?: unknown };

    if (requestBody.mode === "details") {
      if (!Array.isArray(requestBody.flightIds)) {
        return new Response(JSON.stringify({ success: false, error: "flightIds must be an array" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const flightIds: unknown[] = [...new Set(requestBody.flightIds)];
      if (
        flightIds.length > 100
        || flightIds.some((flightId) => typeof flightId !== "string" || !/^\d+$/.test(flightId))
      ) {
        return new Response(JSON.stringify({ success: false, error: "flightIds must contain up to 100 numeric IDs" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const gates: Record<string, string | null> = {};
      const failedIds: string[] = [];
      for (let index = 0; index < flightIds.length; index += 5) {
        const batch = flightIds.slice(index, index + 5) as string[];
        await Promise.all(batch.map(async (flightId) => {
          try {
            gates[flightId] = await getFlightGate(flightId);
          } catch (error) {
            console.error(`TAV flight gate lookup failed for ${flightId}:`, error);
            gates[flightId] = null;
            failedIds.push(flightId);
          }
        }));
      }

      return new Response(JSON.stringify({ success: true, gates, failedIds }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sourceKey = resolveSourceKey((payload as { source?: unknown }).source);
    const sourceUrl = FLIGHT_SOURCE_URLS[sourceKey];

    const baseResponse = await fetch(`${sourceUrl}?_t=${Date.now()}`, {
      headers: {
        "Cache-Control": "no-cache",
        "User-Agent": "Mozilla/5.0",
      },
    });

    if (!baseResponse.ok) {
      throw new Error(`Initial fetch failed: ${baseResponse.status}`);
    }

    const baseHtml = await baseResponse.text();
    const baseRows = countRows(baseHtml);

    const viewState = getInputValue(baseHtml, "__VIEWSTATE");
    const eventValidation = getInputValue(baseHtml, "__EVENTVALIDATION");
    const viewStateGenerator = getInputValue(baseHtml, "__VIEWSTATEGENERATOR");
    const startDateInput = getInputValue(
      baseHtml,
      "ctl00_ctl00_ContentPlaceHolder_ForNested_ContentPlaceHolder_ForNested_RadDateTimePicker_Start_dateInput",
      "ctl00$ctl00$ContentPlaceHolder_ForNested$ContentPlaceHolder_ForNested$RadDateTimePicker_Start$dateInput",
    );
    const endDateInput = getInputValue(
      baseHtml,
      "ctl00_ctl00_ContentPlaceHolder_ForNested_ContentPlaceHolder_ForNested_RadDateTimePicker_End_dateInput",
      "ctl00$ctl00$ContentPlaceHolder_ForNested$ContentPlaceHolder_ForNested$RadDateTimePicker_End$dateInput",
    );

    if (!viewState || !eventValidation || !viewStateGenerator) {
      return new Response(JSON.stringify({
        success: true,
        rowCount: baseRows,
        html: baseHtml,
        source: "initial",
        sourceKey,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cookieHeader = baseResponse.headers.get("set-cookie")?.split(";")[0] || "";

    const form = new URLSearchParams();
    form.set("__EVENTTARGET", MORE_EVENT_TARGET);
    form.set("__EVENTARGUMENT", "");
    form.set("__VIEWSTATE", viewState);
    form.set("__EVENTVALIDATION", eventValidation);
    form.set("__VIEWSTATEGENERATOR", viewStateGenerator);
    form.set("ctl00$ctl00$ContentPlaceHolder_ForNested$ContentPlaceHolder_ForNested$RadDateTimePicker_Start$dateInput", startDateInput);
    form.set("ctl00$ctl00$ContentPlaceHolder_ForNested$ContentPlaceHolder_ForNested$RadDateTimePicker_End$dateInput", endDateInput);

    const moreResponse = await fetch(sourceUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0",
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      body: form.toString(),
    });

    if (!moreResponse.ok) {
      return new Response(JSON.stringify({
        success: true,
        rowCount: baseRows,
        html: baseHtml,
        source: "initial",
        sourceKey,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const moreHtml = await moreResponse.text();
    const moreRows = countRows(moreHtml);
    const finalHtml = moreRows > baseRows ? moreHtml : baseHtml;

    return new Response(JSON.stringify({
      success: true,
      rowCount: Math.max(baseRows, moreRows),
      html: finalHtml,
      source: moreRows > baseRows ? "postback-more" : "initial",
      sourceKey,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
