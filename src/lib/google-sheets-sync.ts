import { supabase } from "@/integrations/supabase/client";

export type GoogleSheetsSyncPayload = {
  departures: Array<{
    updatedAt?: string;
    departureTime: string;
    airline: string;
    flightCode: string;
    tailCode?: string;
    destination: string;
    terminal?: string;
    gate?: string;
    status?: string;
    delayMinutes?: number;
    wheelchairCount?: number;
  }>;
  specialServices: Array<{
    createdAt?: string;
    flightCode: string;
    airline: string;
    destination: string;
    terminal: string;
    gate?: string;
    passengerType: string;
    assignedStaff: string;
    createdBy: string;
    wheelchairId: string;
    specialNotes: string;
  }>;
  inventorySummary: Array<{
    updatedAt?: string;
    terminal: string;
    available: number;
    missing: number;
    maintenance: number;
  }>;
  handovers: Array<{
    createdAt?: string;
    terminal: string;
    fromStaff: string;
    toStaff: string;
    snapshot: string;
    checklist: string;
  }>;
};

type GoogleSheetsSyncResult = {
  success: boolean;
  upstreamStatus?: number;
  upstream?: unknown;
  error?: string;
};

export const triggerGoogleSheetsSync = async (payload: GoogleSheetsSyncPayload) => {
  const { data, error } = await supabase.functions.invoke("sync-google-sheets", {
    body: payload,
  });

  if (error) {
    throw new Error(`Sheets senkronizasyonu basarisiz: ${error.message}`);
  }

  const result = (data || { success: false, error: "Bilinmeyen yanit" }) as GoogleSheetsSyncResult;
  if (!result.success) {
    throw new Error(result.error || "Sheets senkronizasyonu basarisiz");
  }

  return result;
};
