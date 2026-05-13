const OFFLINE_CACHE_PREFIX = "offline-cache:";

const buildKey = (key: string) => `${OFFLINE_CACHE_PREFIX}${key}`;

export const saveOfflineCache = <T>(key: string, value: T) => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(buildKey(key), JSON.stringify(value));
};

export const readOfflineCache = <T>(key: string): T | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(buildKey(key));
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export const removeOfflineCache = (key: string) => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(buildKey(key));
};