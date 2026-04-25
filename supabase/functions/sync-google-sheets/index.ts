const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const syncUrl = Deno.env.get("GOOGLE_SHEETS_SYNC_URL") || "";
    const syncToken = Deno.env.get("GOOGLE_SHEETS_SYNC_TOKEN") || "";

    if (!syncUrl) {
      throw new Error("GOOGLE_SHEETS_SYNC_URL secret eksik.");
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ success: false, error: "Only POST is supported." }), {
        status: 405,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      });
    }

    const payload = await request.json();
    const targetUrl = syncToken
      ? `${syncUrl}${syncUrl.includes("?") ? "&" : "?"}token=${encodeURIComponent(syncToken)}`
      : syncUrl;

    const upstreamResponse = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
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
      return new Response(JSON.stringify({
        success: false,
        error: "Google Sheets endpoint error",
        upstreamStatus: upstreamResponse.status,
        upstream: upstreamJson,
      }), {
        status: 502,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      upstreamStatus: upstreamResponse.status,
      upstream: upstreamJson,
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  }
});
