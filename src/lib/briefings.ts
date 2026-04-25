export const DEFAULT_BRIEFINGS = [
  "Pazartesi 08:30: Haftalik operasyon brifingi",
  "Carsamba 14:00: T2 ekip koordinasyon toplantisi",
  "Cuma 16:30: Hafta sonu yogunluk planlamasi",
];

const STORAGE_KEY = "briefingItems";
export const BRIEFINGS_UPDATED_EVENT = "briefings-updated";

const normalizeBriefings = (items: string[]) =>
  items.map((item) => item.trim()).filter(Boolean);

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

export const saveBriefings = (items: string[]) => {
  const normalized = normalizeBriefings(items);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(BRIEFINGS_UPDATED_EVENT, { detail: normalized }));
};

export const resetBriefings = () => {
  window.localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(BRIEFINGS_UPDATED_EVENT, { detail: DEFAULT_BRIEFINGS }));
};

export const hasCustomBriefings = () => Boolean(window.localStorage.getItem(STORAGE_KEY));