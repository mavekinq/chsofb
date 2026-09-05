const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SOURCE_URL = "https://www.antalya-airport.aero/yolcu-ve-ziyaretciler/ucus-bilgileri/dis-hat-gidis";
const MORE_EVENT_TARGET = "ctl00$ctl00$ContentPlaceHolder_ForNested$ContentPlaceHolder_ForNested$LinkButton_More";

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
    const baseResponse = await fetch(`${SOURCE_URL}?_t=${Date.now()}`, {
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

    const moreResponse = await fetch(SOURCE_URL, {
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
