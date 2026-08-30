import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Clock3, MapPin, PlaneTakeoff, Search, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { fetchFlightPlanEntriesMerged, getIstanbulDateKey, type FlightPlanEntry } from "@/lib/flight-plan";
import { supabase } from "@/integrations/supabase/client";
import { hasSpecialMemberAccess } from "@/lib/special-member";
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
};

type FlightStatusMeta = {
  stage: FlightStage;
  updatedAt: string;
  updatedBy: string | null;
};

const getFlightKey = (flight: FlightPlanEntry) => [
  flight.departureCode,
  flight.departureTime,
  flight.tailNumber,
].join("|");

const sortByDepartureTime = (left: FlightPlanEntry, right: FlightPlanEntry) => {
  return (left.departureTime || "99:99").localeCompare(right.departureTime || "99:99", "tr");
};

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

const mapStatusRows = (rows: ChefDailyStatusRow[]) => {
  return Object.fromEntries(rows.map((row) => [row.flight_key, {
    stage: row.stage,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }])) as Record<string, FlightStatusMeta>;
};

const SpecialMemberPage = () => {
  const navigate = useNavigate();
  const currentUser = localStorage.getItem("userName") || "";
  const securityNumber = localStorage.getItem("securityNumber");
  const hasAccess = useMemo(() => hasSpecialMemberAccess(securityNumber), [securityNumber]);
  const [flights, setFlights] = useState<FlightPlanEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusByFlight, setStatusByFlight] = useState<Record<string, FlightStatusMeta>>({});
  const [savingFlightKey, setSavingFlightKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const snapshotDate = useMemo(() => getIstanbulDateKey(), []);

  const filteredFlights = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("tr");
    if (!query) {
      return flights;
    }

    return flights.filter((flight) => {
      return [flight.tailNumber, flight.departureCode, flight.parkPosition]
        .some((value) => (value || "").toLocaleLowerCase("tr").includes(query));
    });
  }, [flights, search]);

  useEffect(() => {
    if (!currentUser) {
      navigate("/login");
      return;
    }

    if (!hasAccess) {
      navigate("/");
    }
  }, [currentUser, hasAccess, navigate]);

  useEffect(() => {
    if (!hasAccess) {
      return;
    }

    let cancelled = false;

    const loadFlights = async (silent = false) => {
      if (!silent) {
        setLoading(true);
      }

      try {
        const [entries, statusesResponse] = await Promise.all([
          fetchFlightPlanEntriesMerged(),
          supabase
            .from("chef_daily_flight_statuses")
            .select("flight_key, stage, updated_at, updated_by")
            .eq("snapshot_date", snapshotDate),
        ]);

        if (statusesResponse.error) {
          throw statusesResponse.error;
        }

        if (cancelled) {
          return;
        }

        const departureFlights = entries
          .filter((entry) => Boolean(entry.departureCode))
          .sort(sortByDepartureTime);

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
  }, [hasAccess, snapshotDate]);

  const handleStageChange = async (flight: FlightPlanEntry, stage: FlightStage) => {
    const flightKey = getFlightKey(flight);
    const currentStage = statusByFlight[flightKey]?.stage;
    setSavingFlightKey(flightKey);

    try {
      if (currentStage === stage) {
        const { error } = await supabase
          .from("chef_daily_flight_statuses")
          .delete()
          .eq("snapshot_date", snapshotDate)
          .eq("flight_key", flightKey);

        if (error) {
          throw error;
        }

        setStatusByFlight((prev) => {
          const next = { ...prev };
          delete next[flightKey];
          return next;
        });
        return;
      }

      const { error } = await supabase
        .from("chef_daily_flight_statuses")
        .upsert({
          snapshot_date: snapshotDate,
          flight_key: flightKey,
          flight_code: flight.departureCode || "",
          departure_time: flight.departureTime || null,
          stage,
          updated_by: currentUser || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "snapshot_date,flight_key" });

      if (error) {
        throw error;
      }

      setStatusByFlight((prev) => ({
        ...prev,
        [flightKey]: {
          stage,
          updatedAt: new Date().toISOString(),
          updatedBy: currentUser || null,
        },
      }));
    } catch (error) {
      console.error("Chef-Daily stage update failed:", error);
      toast.error("Kart durumu kaydedilemedi");
    } finally {
      setSavingFlightKey(null);
    }
  };

  if (!currentUser || !hasAccess) {
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
                <p className="text-sm text-muted-foreground">Aktif kullanici</p>
                <p className="mt-1 font-heading text-2xl">{currentUser}</p>
              </div>

              <div className="rounded-xl border border-border bg-secondary/30 p-4 md:min-w-52">
                <p className="text-sm text-muted-foreground">Departure uçuş</p>
                <p className="mt-1 font-heading text-2xl">{filteredFlights.length}</p>
              </div>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Uçuş kodu, kuyruk no veya gate ara..."
                className="pl-9 bg-secondary border-border"
              />
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
                              <p className="text-xs text-muted-foreground">
                                Son guncelleyen: {flightStatus.updatedBy || "Bilinmiyor"} • {formatStatusTimestamp(flightStatus.updatedAt)}
                              </p>
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