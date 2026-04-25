import { supabase } from "@/integrations/supabase/client";
import { extractAssignedStaffFromService, getVisibleServiceNotes } from "@/lib/wheelchair-service-utils";

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

type PushDeliveryResult = {
  success: boolean;
  total: number;
  eligible?: number;
  suppressed?: number;
  sent: number;
  failed: number;
  activeShiftStaff?: string[];
};

type ServiceAlertPayload = {
  id?: string;
  flight_iata: string;
  wheelchair_id: string;
  passenger_type: string;
  assigned_staff?: string;
  terminal: string;
  created_by: string;
  notes: string;
  created_at: string;
};

export const SERVICE_ALERT_EVENT = "wheelchair-service-alert";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

const isSecurePushContext = () => {
  if (typeof window === "undefined") {
    return false;
  }

  return window.isSecureContext || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
};

export const isStandaloneDisplayMode = () => {
  if (typeof window === "undefined") {
    return false;
  }

  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || navigatorWithStandalone.standalone === true;
};

const isAppleMobileDevice = () => {
  if (typeof navigator === "undefined") {
    return false;
  }

  const platform = navigator.userAgent || "";
  return /iPhone|iPad|iPod/i.test(platform);
};

export const requiresInstalledPwaForPush = () => isAppleMobileDevice() && !isStandaloneDisplayMode();

const getPushErrorMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || "");
  const normalizedMessage = message.toLocaleLowerCase("tr-TR");

  if (!isSecurePushContext()) {
    return "Web Push için siteyi HTTPS veya localhost üzerinden açmanız gerekiyor. Telefonu lokal IP ile HTTP üstünden açarsanız push aboneliği reddedilir.";
  }

  if (normalizedMessage.includes("push service error") || normalizedMessage.includes("registration failed")) {
    return "Push servisi aboneliği reddetti. Eski abonelik temizlenip tekrar denenebilir; sayfayı yenileyip yeniden izin verin.";
  }

  if (normalizedMessage.includes("notallowederror") || normalizedMessage.includes("permission denied")) {
    return "Tarayıcı bildirim iznini engelledi. Tarayıcı ayarlarından bu site için bildirimi açın.";
  }

  if (normalizedMessage.includes("aborterror")) {
    return "Push aboneliği oluşturulurken bağlantı kesildi. İnternet bağlantısını kontrol edip tekrar deneyin.";
  }

  if (normalizedMessage.includes("row-level security") || normalizedMessage.includes("policy for table \"push_subscriptions\"")) {
    return "Push aboneliği veritabanına kaydedilemedi. Push subscription tablo izni yeni güncellendi; siteyi yenileyip tekrar deneyin.";
  }

  return message;
};

export const isNotificationSupported = () => {
  if (typeof window === "undefined") {
    return false;
  }

  return "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
};

export const getNotificationPermissionState = () => {
  if (!isNotificationSupported()) {
    return "unsupported" as const;
  }

  return Notification.permission;
};

export const requestNotificationPermission = async () => {
  if (!isNotificationSupported()) {
    throw new Error("Bu cihazda bildirim desteği bulunmuyor.");
  }

  return Notification.requestPermission();
};

const urlBase64ToUint8Array = (base64String: string) => {
  const normalized = `${base64String}${"=".repeat((4 - (base64String.length % 4)) % 4)}`
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const rawData = window.atob(normalized);
  return Uint8Array.from(rawData, (character) => character.charCodeAt(0));
};

const getPushRegistration = async () => {
  if (!VAPID_PUBLIC_KEY) {
    throw new Error("VAPID public key eksik. VITE_VAPID_PUBLIC_KEY ayarlanmalı.");
  }

  return navigator.serviceWorker.ready;
};

const subscribeToPush = async (registration: ServiceWorkerRegistration) => {
  await registration.update();

  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
};

export const ensurePushSubscription = async (userName: string) => {
  if (!isNotificationSupported()) {
    throw new Error("Bu cihazda web push desteği bulunmuyor.");
  }

  if (!isSecurePushContext()) {
    throw new Error("Web Push için siteyi HTTPS veya localhost üzerinden açmanız gerekiyor. Telefonda lokal IP yerine HTTPS ngrok ya da canlı domain kullanın.");
  }

  if (requiresInstalledPwaForPush()) {
    throw new Error("iPhone/iPad tarafında arka plan bildirimi için uygulamayı Safari paylaş menüsünden Ana Ekrana Ekle ile kurup oradan açmanız gerekiyor.");
  }

  const permission = getNotificationPermissionState() === "granted"
    ? "granted"
    : await requestNotificationPermission();

  if (permission !== "granted") {
    throw new Error("Bildirim izni verilmedi.");
  }

  const registration = await getPushRegistration();
  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    try {
      subscription = await subscribeToPush(registration);
    } catch (error) {
      const staleSubscription = await registration.pushManager.getSubscription();

      if (staleSubscription) {
        await staleSubscription.unsubscribe().catch(() => undefined);
      }

      try {
        subscription = await subscribeToPush(registration);
      } catch (retryError) {
        throw new Error(getPushErrorMessage(retryError || error));
      }
    }
  }

  const serializedSubscription = subscription.toJSON();
  const { error } = await supabase.from("push_subscriptions").upsert({
    endpoint: subscription.endpoint,
    is_active: true,
    last_seen_at: new Date().toISOString(),
    subscription: serializedSubscription,
    user_agent: navigator.userAgent,
    user_name: userName,
  }, {
    onConflict: "endpoint",
  });

  if (error) {
    throw new Error(`Push aboneliği kaydedilemedi: ${error.message}`);
  }

  return subscription;
};

export const syncPushSubscriptionIfEnabled = async (userName: string) => {
  if (!userName || getNotificationPermissionState() !== "granted") {
    return;
  }

  await ensurePushSubscription(userName);
};

export const triggerServicePushNotification = async (service: ServicePushPayload) => {
  const { data, error } = await supabase.functions.invoke("send-service-push", {
    body: service,
  });

  if (error) {
    throw new Error(`Push bildirimi gönderilemedi: ${error.message}`);
  }

  return (data || {
    success: true,
    total: 0,
    sent: 0,
    failed: 0,
  }) as PushDeliveryResult;
};

export const triggerTestPushNotification = async (createdBy: string) => {
  return triggerServicePushNotification({
    assigned_staff: "Test Personeli",
    created_at: new Date().toISOString(),
    created_by: createdBy,
    flight_iata: "TEST001",
    notes: "Bu bir admin test bildirimidir.",
    passenger_type: "TEST",
    terminal: "GENEL",
    wheelchair_id: "TEST-TS",
  });
};

export const showRealtimeServiceAlert = async (service: ServiceAlertPayload) => {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(SERVICE_ALERT_EVENT, {
    detail: service,
  }));

  if (!("Notification" in window) || Notification.permission !== "granted") {
    return;
  }

  const assignedStaff = extractAssignedStaffFromService(service) || "Belirtilmedi";
  const visibleNotes = getVisibleServiceNotes(service.notes);
  const body = [
    `${service.wheelchair_id} • ${service.passenger_type}`,
    `Atanan: ${assignedStaff}`,
    `Terminal: ${service.terminal}`,
    visibleNotes ? `Not: ${visibleNotes}` : "",
  ]
    .filter(Boolean)
    .join(" • ");

  const title = `Yeni hizmet: ${service.flight_iata}`;
  const tag = service.id ? `foreground-service-${service.id}` : `foreground-service-${service.flight_iata}`;

  if (document.visibilityState === "visible") {
    const notification = new Notification(title, {
      body,
      icon: "/celebi-logo.png",
      tag,
    });

    window.setTimeout(() => {
      notification.close();
    }, 10000);

    return;
  }

  if ("serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification(title, {
      body,
      icon: "/celebi-logo.png",
      badge: "/celebi-logo.png",
      tag,
      renotify: false,
      data: { url: "/wheelchair-services" },
    });
    return;
  }

  new Notification(title, {
    body,
    icon: "/celebi-logo.png",
    tag,
  });
};
