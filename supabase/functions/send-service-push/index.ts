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
  dep_gate?: string;
  notification_kind?: "service-created" | "service-updated" | "counter-close" | "announcement";
  custom_title?: string;
  custom_body?: string;
  custom_url?: string;
  custom_tag?: string;
  // If provided, only send to users whose name is in this list (on-shift filter)
  // Announcements are always sent to all users regardless of this field
  on_shift_users?: string[];
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

const isAnnouncementPayload = (service: ServicePushPayload) => {
  return service.notification_kind === "announcement"
    || Boolean(service.custom_title?.trim())
    || Boolean(service.custom_body?.trim());
};

const buildNotificationBody = (service: ServicePushPayload) => {
  if (isAnnouncementPayload(service)) {
    return service.custom_body?.trim() || service.notes?.trim() || "Yeni bir duyuru paylaşıldı.";
  }

  if (service.notification_kind === "counter-close" || service.passenger_type === "BILDIRIM") {
    const details = [
      `Uçuş: ${service.flight_iata}`,
      `Terminal: ${service.terminal}`,
    ];

    if (service.dep_gate && service.dep_gate !== "-") {
      details.push(`Gate: ${service.dep_gate}`);
    }

    if (service.notes?.trim()) {
      details.push(service.notes.trim());
    }

    return details.join(" • ");
  }

  const details = [
    `Uçuş: ${service.flight_iata}`,
    `Sandalye: ${service.wheelchair_id}`,
    `Yolcu: ${service.passenger_type}`,
    `Atanan: ${service.assigned_staff || "Belirtilmedi"}`,
    `Terminal: ${service.terminal}`,
  ];

  if (service.dep_gate && service.dep_gate !== "-") {
    details.push(`Gate: ${service.dep_gate}`);
  }

  details.push(`Açan: ${service.created_by}`);

  if (service.notes?.trim()) {
    details.push(`Not: ${service.notes.trim()}`);
  }

  return details.join(" • ");
};

const buildNotificationTitle = (service: ServicePushPayload) => {
  if (isAnnouncementPayload(service)) {
    return service.custom_title?.trim() || "📢 Operasyon Duyurusu";
  }
  if (service.notification_kind === "counter-close" || service.passenger_type === "BILDIRIM") {
    return `🔔 Kontuar Kapandı: ${service.flight_iata}`;
  }
  if (service.notification_kind === "service-updated") {
    return `Hizmet Güncellendi: ${service.flight_iata}`;
  }
  return `Yeni Hizmet: ${service.flight_iata}`;
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

    const { data: subscriptions, error: subscriptionError } = await supabaseAdmin
      .from("push_subscriptions")
      .select("endpoint, subscription, user_name")
      .eq("is_active", true);

    if (subscriptionError) {
      throw subscriptionError;
    }

    const allSubscriptions = (subscriptions || []) as PushSubscriptionRow[];

    // Filter to on-shift users only (unless this is an announcement)
    const isAnnouncement = isAnnouncementPayload(service);
    const eligibleSubscriptions = (!isAnnouncement && service.on_shift_users && service.on_shift_users.length > 0)
      ? allSubscriptions.filter((sub) => service.on_shift_users!.some(
          (shiftUser) => shiftUser.trim().toLowerCase() === sub.user_name.trim().toLowerCase()
        ))
      : allSubscriptions;

    const payload = JSON.stringify({
      title: buildNotificationTitle(service),
      body: buildNotificationBody(service),
      tag: service.custom_tag || (service.id ? `wheelchair-service-${service.id}` : `wheelchair-service-${service.flight_iata}`),
      url: service.custom_url || "/wheelchair-services",
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
      total: eligibleSubscriptions.length,
      sent: results.filter((result) => result.sent).length,
      failed: results.filter((result) => !result.sent).length,
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