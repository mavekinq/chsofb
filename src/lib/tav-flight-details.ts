import { supabase } from "@/integrations/supabase/client";

type TavFlightGatesResponse = {
  success: boolean;
  gates?: Record<string, string | null>;
  failedIds?: string[];
  error?: string;
};

export async function attachTavFlightGates<T extends { id: string | null }>(
  flights: T[],
): Promise<{ flights: Array<T & { gate: string | null }>; warning: string }> {
  const flightIds = [...new Set(flights
    .map((flight) => flight.id)
    .filter((id): id is string => Boolean(id && /^\d+$/.test(id))))];
  const emptyGates = flights.map((flight) => ({ ...flight, gate: null }));

  if (flightIds.length === 0) {
    return { flights: emptyGates, warning: "Gate bilgisi için uçuş ID'si bulunamadı." };
  }

  try {
    const { data, error } = await supabase.functions.invoke<TavFlightGatesResponse>("fetch-tav-flights", {
      body: { mode: "details", flightIds },
    });

    if (error) throw error;
    if (!data?.success || !data.gates) {
      throw new Error(data?.error || "TAV uçuş detayları geçersiz yanıt döndürdü.");
    }

    const resultFlights = flights.map((flight) => ({
      ...flight,
      gate: flight.id ? data.gates?.[flight.id] || null : null,
    }));
    const unavailableCount = resultFlights.filter((flight) => !flight.gate).length;

    return {
      flights: resultFlights,
      warning: unavailableCount > 0
        ? `${unavailableCount} uçuş için Gate bilgisi bulunamadı.`
        : "",
    };
  } catch (error) {
    console.error("TAV flight gate details fetch failed:", error);
    return { flights: emptyGates, warning: "Gate bilgileri alınamadı." };
  }
}
