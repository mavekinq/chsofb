import { createClient } from "jsr:@supabase/supabase-js@2";

type StageKey = "hazirlik" | "boarding";
type ReminderRow = {
  id: string;
  snapshot_date: string;
  flight_key: string;
  flight_code: string;
  stage_times: Record<string, unknown> | null;
  stage_updated_by: Record<string, unknown> | null;
};

const REMINDERS: Record<StageKey, { delayMs: number; messages: string[]; title: string }> = {
  hazirlik: {
    delayMs: 10 * 60 * 1000,
    title: "🟡 Boarding zamanı yaklaşıyor",
    messages: [
      "Hazırlık tamam gibi görünüyor; boarding’i de başlatalım mı? ✈️🙂",
      "Uçak seni bekliyor, boarding düğmesi biraz ilgi bekliyor olabilir 🛫😄",
      "Hazırlık kaydı alındı. Boarding’e geçmeyi unutma; kahramanlık kapıda! 🦸‍♂️🟡",
      "10 dakikadır hazırlıktayız; boarding zamanı gelmiş olabilir ⏰✈️😉",
    ],
  },
  boarding: {
    delayMs: 15 * 60 * 1000,
    title: "🔴 Gate Close hatırlatması",
    messages: [
      "Boarding başladı; gate close durumunu da güncellemeyi unutma 🚪🙂",
      "Gate Close düğmesi seni özledi. Uçuş durumunu kontrol eder misin? ✈️😄",
      "Boarding’den sonra son adım bekliyor: Gate Close 🔴⏰",
      "Operasyonun final sahnesi yaklaşıyor; Gate Close durumunu işaretleyelim 🎬🛫😉",
    ],
  },
};

const asTimestamp = (value: unknown) => {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
};

const getIstanbulDateKey = (date: Date) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Istanbul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(date);

const getYesterdayDateKey = (todayKey: string) => {
  const [year, month, day] = todayKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ success: false, error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase service configuration is missing");
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const todayKey = getIstanbulDateKey(new Date());
    const { data: rows, error } = await supabaseAdmin
      .from("chef_daily_flight_statuses")
      .select("id, snapshot_date, flight_key, flight_code, stage_times, stage_updated_by")
      .gte("snapshot_date", getYesterdayDateKey(todayKey));

    if (error) throw error;

    let sent = 0;
    let skipped = 0;
    const now = Date.now();

    for (const row of (rows || []) as ReminderRow[]) {
      const times = row.stage_times || {};
      const users = row.stage_updated_by || {};
      const gateCloseTime = asTimestamp(times["gate-close"]);

      for (const stage of ["hazirlik", "boarding"] as const) {
        const stageTimeValue = times[stage];
        const stageTimestamp = asTimestamp(stageTimeValue);
        const recipient = typeof users[stage] === "string" ? users[stage].trim() : "";
        const downstreamTime = asTimestamp(times[stage === "hazirlik" ? "boarding" : "gate-close"]);

        if (
          !stageTimestamp
          || !recipient
          || now - stageTimestamp < REMINDERS[stage].delayMs
          || (downstreamTime !== null && downstreamTime >= stageTimestamp)
          || (stage === "hazirlik" && gateCloseTime !== null && gateCloseTime >= stageTimestamp)
        ) {
          skipped += 1;
          continue;
        }

        const reminderKey = `${stage}:${String(stageTimeValue)}`;
        const { data: claimed, error: claimError } = await supabaseAdmin.rpc(
          "claim_chef_daily_stage_reminder",
          {
            p_id: row.id,
            p_stage_key: stage,
            p_stage_timestamp: String(stageTimeValue),
            p_reminder_key: reminderKey,
          },
        );

        if (claimError) throw claimError;
        if (!claimed) {
          skipped += 1;
          continue;
        }

        const message = REMINDERS[stage].messages[
          Math.floor(Math.random() * REMINDERS[stage].messages.length)
        ];

        try {
          const { error: pushError } = await supabaseAdmin.functions.invoke("send-service-push", {
            body: {
              flight_iata: row.flight_code,
              wheelchair_id: `STAGE-REMINDER-${stage}`,
              passenger_type: "BILDIRIM",
              assigned_staff: recipient,
              terminal: "GENEL",
              created_by: recipient,
              notes: message,
              created_at: new Date().toISOString(),
              notification_kind: "flight-note",
              custom_title: REMINDERS[stage].title,
              custom_body: `${row.flight_code}: ${message}`,
              custom_url: "/wheelchair-services",
              custom_tag: `stage-reminder-${row.id}-${reminderKey}`,
              on_shift_users: [recipient],
            },
          });

          if (pushError) throw pushError;

          const { error: finishError } = await supabaseAdmin.rpc(
            "finish_chef_daily_stage_reminder",
            { p_id: row.id, p_reminder_key: reminderKey, p_sent: true },
          );
          if (finishError) throw finishError;
          sent += 1;
        } catch (pushError) {
          console.error("Stage reminder push failed:", {
            flightCode: row.flight_code,
            stage,
            recipient,
            error: pushError instanceof Error ? pushError.message : String(pushError),
          });
          const { error: releaseError } = await supabaseAdmin.rpc(
            "finish_chef_daily_stage_reminder",
            { p_id: row.id, p_reminder_key: reminderKey, p_sent: false },
          );
          if (releaseError) {
            console.error("Stage reminder claim release failed:", releaseError);
          }
        }
      }
    }

    return new Response(JSON.stringify({ success: true, examined: rows?.length || 0, sent, skipped }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Chef-Daily stage reminder processor failed:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
