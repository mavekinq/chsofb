import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ServicePushPayload = {
  id?: string;
  flight_iata: string;
  wheelchair_id: string;
  passenger_type: string;
  assigned_staff: string;
  terminal: string;
  created_by: string;
  notes: string;
  created_at: string;
};

type PushSubscriptionRow = {
  endpoint: string;
  user_name: string;
  subscription: {
    endpoint: string;
    expirationTime?: number | null;
    keys?: {
      auth?: string;
      p256dh?: string;
    };
  };
};

const normalizeStaffName = (value: string) => value.trim().toLocaleLowerCase("tr");

const buildNotificationBody = (service: ServicePushPayload) => {
  const details = [
    `Uçuş: ${service.flight_iata}`,
    `Sandalye: ${service.wheelchair_id}`,
    `Yolcu: ${service.passenger_type}`,
    `Atanan: ${service.assigned_staff || "Belirtilmedi"}`,
    `Terminal: ${service.terminal}`,
    `Açan: ${service.created_by}`,
  ];

  if (service.notes?.trim()) {
    details.push(`Not: ${service.notes.trim()}`);
  }

  return details.join(" • ");
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:ops@example.com";

    if (!supabaseUrl || !supabaseServiceRoleKey || !vapidPublicKey || !vapidPrivateKey) {
      throw new Error("Eksik Supabase veya VAPID secret ayari var.");
    }

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    const service = await request.json() as ServicePushPayload;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

    const [
      { data: subscriptions, error: subscriptionError },
      { data: activeShifts, error: shiftError },
    ] = await Promise.all([
      supabaseAdmin
        .from("push_subscriptions")
        .select("endpoint, subscription, user_name")
        .eq("is_active", true),
      supabaseAdmin
        .from("shifts")
        .select("staff_name")
        .is("ended_at", null),
    ]);

    if (subscriptionError || shiftError) {
      throw subscriptionError || shiftError;
    }

    const activeShiftStaff = new Set((activeShifts || [])
      .map((row) => row.staff_name)
      .filter(Boolean)
      .map((staffName) => normalizeStaffName(staffName)));

    const eligibleSubscriptions = (subscriptions || []).filter((row) =>
      activeShiftStaff.has(normalizeStaffName(row.user_name || "")),
    ) as PushSubscriptionRow[];

    const payload = JSON.stringify({
      title: `Yeni Hizmet: ${service.flight_iata}`,
      body: buildNotificationBody(service),
      tag: service.id ? `wheelchair-service-${service.id}` : `wheelchair-service-${service.flight_iata}`,
      url: "/wheelchair-services",
    });

    const results = await Promise.all(eligibleSubscriptions.map(async (subscriptionRow) => {

      try {
        await webpush.sendNotification(subscriptionRow.subscription, payload);
        return { endpoint: subscriptionRow.endpoint, sent: true };
      } catch (pushError) {
        const statusCode = typeof pushError === "object" && pushError !== null && "statusCode" in pushError
          ? Number(pushError.statusCode)
          : 0;

        if (statusCode === 404 || statusCode === 410) {
          await supabaseAdmin.from("push_subscriptions").delete().eq("endpoint", subscriptionRow.endpoint);
        }

        return {
          endpoint: subscriptionRow.endpoint,
          sent: false,
          error: pushError instanceof Error ? pushError.message : String(pushError),
        };
      }
    }));

    return new Response(JSON.stringify({
      success: true,
      total: (subscriptions || []).length,
      eligible: eligibleSubscriptions.length,
      suppressed: Math.max((subscriptions || []).length - eligibleSubscriptions.length, 0),
      sent: results.filter((result) => result.sent).length,
      failed: results.filter((result) => !result.sent).length,
      activeShiftStaff: Array.from(activeShiftStaff),
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