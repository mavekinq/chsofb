import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Clock3, Filter, MapPin, PlaneTakeoff, Search, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  fetchFlightPlanEntriesForDate,
  fetchFlightPlanEntriesMerged,
  fetchFlightPlanSnapshotDates,
  getIstanbulDateKey,
  type FlightPlanEntry,
} from "@/lib/flight-plan";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type FlightStage = "hazirlik" | "boarding" | "gate-close";

const FLIGHT_STAGES: Array<{ key: FlightStage; label: string; className: string }> = [
  { key: "hazirlik", label: "Hazırlık", className: "border-yellow-500/40 text-yellow-300 hover:bg-yellow-500/10" },
  { key: "boarding", label: "Boarding", className: "border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10" },
  { key: "gate-close", label: "Gate Close", className: "border-rose-500/40 text-rose-300 hover:bg-rose-500/10" },
];

const STAGE_CARD_STYLES: Record<FlightStage, string> = {
  hazirlik: "border-yellow-500/45 bg-yellow-500/10",
  boarding: "border-emerald-500/45 bg-emerald-500/10",
  "gate-close": "border-rose-500/45 bg-rose-500/10",
};

const STAGE_BUTTON_ACTIVE_STYLES: Record<FlightStage, string> = {
  hazirlik: "bg-yellow-500 text-black border-yellow-500 hover:bg-yellow-400 hover:text-black",
  boarding: "bg-emerald-500 text-white border-emerald-500 hover:bg-emerald-400",
  "gate-close": "bg-rose-500 text-white border-rose-500 hover:bg-rose-400",
};

type ChefDailyStatusRow = {
  flight_key: string;
  stage: FlightStage;
  updated_at: string;
  updated_by: string | null;
  stage_times: Record<string, string> | null;
};

type FlightStatusMeta = {
  stage: FlightStage;
  updatedAt: string;
  updatedBy: string | null;
  stageTimes: Partial<Record<FlightStage, string>>;
};

const getFlightKey = (flight: FlightPlanEntry) => [
  flight.departureCode,
  flight.departureTime,
  flight.tailNumber,
].join("|");

const formatStatusTimestamp = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Saat bilgisi yok";
  }

  return date.toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatSnapshotDate = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);
  return date.toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

const parseStageTimes = (value: unknown): Partial<Record<FlightStage, string>> => {
  if (!value || typeof value !== "object") {
    return {};
  }

  const raw = value as Record<string, unknown>;
  const result: Partial<Record<FlightStage, string>> = {};

  FLIGHT_STAGES.forEach((stage) => {
    const timestamp = raw[stage.key];
    if (typeof timestamp === "string") {
      result[stage.key] = timestamp;
    }
  });

  return result;
};

const mapStatusRows = (rows: ChefDailyStatusRow[]) => {
  return Object.fromEntries(rows.map((row) => [row.flight_key, {
    stage: row.stage,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    stageTimes: parseStageTimes(row.stage_times),
  }])) as Record<string, FlightStatusMeta>;
};

const SpecialMemberPage = () => {
  const navigate = useNavigate();
  const currentUser = localStorage.getItem("userName") || "";
  const todayDateKey = useMemo(() => getIstanbulDateKey(), []);
  const [availableDates, setAvailableDates] = useState<string[]>([todayDateKey]);
  const [selectedDate, setSelectedDate] = useState(todayDateKey);
  const [flights, setFlights] = useState<FlightPlanEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusByFlight, setStatusByFlight] = useState<Record<string, FlightStatusMeta>>({});
  const [savingFlightKey, setSavingFlightKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showGateClose, setShowGateClose] = useState(false);

  useEffect(() => {
    const loadSnapshotDates = async () => {
      try {
        const snapshotDates = await fetchFlightPlanSnapshotDates();
        const mergedDates = Array.from(new Set([todayDateKey, ...snapshotDates]));
        setAvailableDates(mergedDates);
      } catch {
        setAvailableDates([todayDateKey]);
      }
    };

    void loadSnapshotDates();
  }, [todayDateKey]);

  const filteredFlights = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("tr");
    return flights.filter((flight) => {
      const status = statusByFlight[getFlightKey(flight)];
      if (!showGateClose && status?.stage === "gate-close") {
        return false;
      }

      if (!query) {
        return true;
      }

      return [flight.tailNumber, flight.departureCode, flight.parkPosition]
        .some((value) => (value || "").toLocaleLowerCase("tr").includes(query));
    });
  }, [flights, search, showGateClose, statusByFlight]);

  useEffect(() => {
    if (!currentUser) {
      navigate("/login");
    }
  }, [currentUser, navigate]);

  useEffect(() => {
    if (!currentUser) {
      return;
    }

    let cancelled = false;

    const loadFlights = async (silent = false) => {
      if (!silent) {
        setLoading(true);
      }

      try {
        const flightsPromise = selectedDate === todayDateKey
          ? fetchFlightPlanEntriesMerged()
          : fetchFlightPlanEntriesForDate(selectedDate);

        const [entries, statusesResponse] = await Promise.all([
          flightsPromise,
          supabase
            .from("chef_daily_flight_statuses")
            .select("flight_key, stage, updated_at, updated_by, stage_times")
            .eq("snapshot_date", selectedDate),
        ]);

        if (statusesResponse.error) {
          throw statusesResponse.error;
        }

        if (cancelled) {
          return;
        }

        const departureFlights = entries
          .filter((entry) => Boolean(entry.departureCode));

        setFlights(departureFlights);
        setStatusByFlight(mapStatusRows((statusesResponse.data || []) as ChefDailyStatusRow[]));
      } catch (error) {
        if (!cancelled) {
          console.error("Chef-Daily load failed:", error);
          toast.error("Chef-Daily verileri yüklenemedi");
        }
      } finally {
        if (!cancelled && !silent) {
          setLoading(false);
        }
      }
    };

    void loadFlights();

    const interval = window.setInterval(() => {
      void loadFlights(true);
    }, 60000);

    const channel = supabase
      .channel("chef-daily-flight-statuses")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chef_daily_flight_statuses" },
        (payload) => {
          const nextRecord = (payload.new || payload.old) as {
            snapshot_date?: string;
            flight_key?: string;
            stage?: FlightStage;
            updated_at?: string;
            updated_by?: string | null;
          };
          if (nextRecord.snapshot_date !== snapshotDate || !nextRecord.flight_key) {
            return;
          }

          setStatusByFlight((prev) => {
            const next = { ...prev };

            if (payload.eventType === "DELETE") {
              delete next[nextRecord.flight_key as string];
              return next;
            }

            if (nextRecord.stage && nextRecord.updated_at) {
              next[nextRecord.flight_key as string] = {
                stage: nextRecord.stage,
                updatedAt: nextRecord.updated_at,
                updatedBy: nextRecord.updated_by || null,
              };
            }

            return next;
          });
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, [currentUser, selectedDate, todayDateKey]);

  const handleStageChange = async (flight: FlightPlanEntry, stage: FlightStage) => {
    const flightKey = getFlightKey(flight);
    const stageTimes = statusByFlight[flightKey]?.stageTimes || {};
    setSavingFlightKey(flightKey);

    try {
      const nowIso = new Date().toISOString();
      const nextStageTimes = {
        ...stageTimes,
        [stage]: nowIso,
      };

      const { error } = await supabase
        .from("chef_daily_flight_statuses")
        .upsert({
          snapshot_date: selectedDate,
          flight_key: flightKey,
          flight_code: flight.departureCode || "",
          departure_time: flight.departureTime || null,
          stage,
          stage_times: nextStageTimes,
          updated_by: currentUser || null,
          updated_at: nowIso,
        }, { onConflict: "snapshot_date,flight_key" });

      if (error) {
        throw error;
      }

      setStatusByFlight((prev) => ({
        ...prev,
        [flightKey]: {
          stage,
          updatedAt: nowIso,
          updatedBy: currentUser || null,
          stageTimes: nextStageTimes,
        },
      }));
    } catch (error) {
      console.error("Chef-Daily stage update failed:", error);
      toast.error("Kart durumu kaydedilemedi");
    } finally {
      setSavingFlightKey(null);
    }
  };

  if (!currentUser) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-30">
        <div className="container h-14 px-4 flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <h1 className="font-heading font-semibold text-lg">Chef-Daily</h1>
        </div>
      </header>

      <main className="container max-w-5xl px-4 py-6 space-y-4">
        <Card className="border-amber-500/30 bg-[linear-gradient(135deg,hsl(var(--card))_0%,hsl(42_85%_65%/0.12)_100%)]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Star className="w-5 h-5 text-amber-400" />
              Chef-Daily
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <div className="rounded-xl border border-border bg-secondary/30 p-4">
                <p className="text-sm text-muted-foreground">Tarih</p>
                <Select value={selectedDate} onValueChange={setSelectedDate}>
                  <SelectTrigger className="mt-2 bg-background border-border">
                    <SelectValue placeholder="Tarih seçin" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    {availableDates.map((dateKey) => (
                      <SelectItem key={dateKey} value={dateKey}>
                        {formatSnapshotDate(dateKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-xl border border-border bg-secondary/30 p-4 md:min-w-52">
                <p className="text-sm text-muted-foreground">Departure uçuş</p>
                <p className="mt-1 font-heading text-2xl">{filteredFlights.length}</p>
              </div>
            </div>

            <div className="flex flex-col gap-2 md:flex-row">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Uçuş kodu, kuyruk no veya gate ara..."
                  className="pl-9 bg-secondary border-border"
                />
              </div>
              <Button
                type="button"
                variant={showGateClose ? "default" : "outline"}
                className="md:w-auto"
                onClick={() => setShowGateClose((prev) => !prev)}
              >
                <Filter className="h-4 w-4 mr-2" />
                {showGateClose ? "Gate Close Gizle" : "Gate Close Göster"}
              </Button>
            </div>

            {loading ? (
              <div className="rounded-xl border border-border bg-card/70 p-8 text-center text-muted-foreground">
                Departure uçuşları yükleniyor...
              </div>
            ) : filteredFlights.length === 0 ? (
              <div className="rounded-xl border border-border bg-card/70 p-8 text-center text-muted-foreground">
                {search.trim() ? "Aramana uygun departure uçuşu bulunamadı." : "Listelenecek departure uçuşu bulunamadı."}
              </div>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {filteredFlights.map((flight) => {
                  const flightKey = getFlightKey(flight);
                  const flightStatus = statusByFlight[flightKey];
                  const activeStage = flightStatus?.stage;
                  const isSaving = savingFlightKey === flightKey;

                  return (
                    <Card key={flightKey} className={cn("border-border/80 bg-card/80 transition-colors", activeStage && STAGE_CARD_STYLES[activeStage])}>
                      <CardContent className="p-4 space-y-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-2 min-w-0">
                            <div className="flex items-center gap-2">
                              <PlaneTakeoff className="h-4 w-4 text-primary" />
                              <p className="font-heading text-xl truncate">{flight.departureCode || "—"}</p>
                              {activeStage && (
                                <Badge className="bg-primary/15 text-primary border-primary/20">
                                  {FLIGHT_STAGES.find((item) => item.key === activeStage)?.label}
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {flight.departureIATA || "Bilinmiyor"} • {flight.aircraftType || "Tip yok"}
                            </p>
                            {flightStatus && (
                              <div className="space-y-1 text-xs text-muted-foreground">
                                <p>
                                  Son guncelleyen: {flightStatus.updatedBy || "Bilinmiyor"} • {formatStatusTimestamp(flightStatus.updatedAt)}
                                </p>
                                <p>
                                  Hazırlık: {flightStatus.stageTimes.hazirlik ? formatStatusTimestamp(flightStatus.stageTimes.hazirlik) : "-"}
                                </p>
                                <p>
                                  Boarding: {flightStatus.stageTimes.boarding ? formatStatusTimestamp(flightStatus.stageTimes.boarding) : "-"}
                                </p>
                                <p>
                                  Gate Close: {flightStatus.stageTimes["gate-close"] ? formatStatusTimestamp(flightStatus.stageTimes["gate-close"]) : "-"}
                                </p>
                              </div>
                            )}
                          </div>

                          <div className="text-right shrink-0">
                            <div className="flex items-center gap-1 text-sm font-medium justify-end">
                              <Clock3 className="h-3.5 w-3.5 text-muted-foreground" />
                              {flight.departureTime || "—"}
                            </div>
                            <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground justify-end">
                              <MapPin className="h-3.5 w-3.5" />
                              {flight.parkPosition || "Park yok"}
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div className="rounded-lg border border-border bg-secondary/20 p-3">
                            <p className="text-xs text-muted-foreground">Tail Number</p>
                            <p className="mt-1 font-mono font-medium">{flight.tailNumber || "—"}</p>
                          </div>
                          <div className="rounded-lg border border-border bg-secondary/20 p-3">
                            <p className="text-xs text-muted-foreground">Özel Not</p>
                            <p className="mt-1 font-medium truncate">{flight.specialNotes || "—"}</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                          {FLIGHT_STAGES.map((stage) => {
                            const isActive = activeStage === stage.key;

                            return (
                              <Button
                                key={stage.key}
                                type="button"
                                variant="outline"
                                  disabled={isSaving}
                                className={cn(
                                  "font-medium",
                                  stage.className,
                                    isActive && STAGE_BUTTON_ACTIVE_STYLES[stage.key],
                                )}
                                onClick={() => handleStageChange(flight, stage.key)}
                              >
                                {isSaving && isActive ? "Kaydediliyor..." : stage.label}
                              </Button>
                            );
                          })}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default SpecialMemberPage;