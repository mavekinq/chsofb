import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export const DEFAULT_BRIEFINGS = [
  "Pazartesi 08:30: Haftalik operasyon brifingi",
  "Carsamba 14:00: T2 ekip koordinasyon toplantisi",
  "Cuma 16:30: Hafta sonu yogunluk planlamasi",
];

const STORAGE_KEY = "briefingItems";
const REMOTE_TABLE = "briefings_state";
const REMOTE_ROW_ID = "global";
export const BRIEFINGS_UPDATED_EVENT = "briefings-updated";

const normalizeBriefings = (items: string[]) =>
  items.map((item) => item.trim()).filter(Boolean);

export const isCustomBriefings = (items: string[]) => {
  return JSON.stringify(normalizeBriefings(items)) !== JSON.stringify(DEFAULT_BRIEFINGS);
};

const isBriefingsPayload = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const writeLocalBriefings = (items: string[]) => {
  const normalized = normalizeBriefings(items);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
};

const dispatchBriefingsUpdated = (items: string[]) => {
  const normalized = normalizeBriefings(items);
  window.dispatchEvent(new CustomEvent(BRIEFINGS_UPDATED_EVENT, { detail: normalized }));
};

export const getBriefings = () => {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return DEFAULT_BRIEFINGS;
  }

  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      return DEFAULT_BRIEFINGS;
    }

    const normalized = normalizeBriefings(parsed.filter((item): item is string => typeof item === "string"));
    return normalized.length ? normalized : DEFAULT_BRIEFINGS;
  } catch {
    return DEFAULT_BRIEFINGS;
  }
};

export const loadBriefings = async () => {
  const localBriefings = getBriefings();

  try {
    const { data, error } = await supabase
      .from(REMOTE_TABLE)
      .select("payload")
      .eq("id", REMOTE_ROW_ID)
      .maybeSingle();

    if (error) {
      console.error("Briefings fetch failed:", error);
      return localBriefings;
    }

    if (!data || !isBriefingsPayload(data.payload)) {
      return localBriefings;
    }

    const remoteBriefings = normalizeBriefings(data.payload);
    const nextBriefings = remoteBriefings.length ? remoteBriefings : DEFAULT_BRIEFINGS;
    writeLocalBriefings(nextBriefings);
    dispatchBriefingsUpdated(nextBriefings);
    return nextBriefings;
  } catch (error) {
    console.error("Briefings fetch failed:", error);
    return localBriefings;
  }
};

export const saveBriefings = async (items: string[]) => {
  const normalized = normalizeBriefings(items);
  writeLocalBriefings(normalized);
  dispatchBriefingsUpdated(normalized);

  const { error } = await supabase
    .from(REMOTE_TABLE)
    .upsert({
      id: REMOTE_ROW_ID,
      payload: normalized as unknown as Json,
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });

  if (error) {
    throw error;
  }
};

export const resetBriefings = async () => {
  window.localStorage.removeItem(STORAGE_KEY);
  dispatchBriefingsUpdated(DEFAULT_BRIEFINGS);

  const { error } = await supabase
    .from(REMOTE_TABLE)
    .upsert({
      id: REMOTE_ROW_ID,
      payload: DEFAULT_BRIEFINGS as unknown as Json,
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });

  if (error) {
    throw error;
  }
};

export const hasCustomBriefings = () => isCustomBriefings(getBriefings());