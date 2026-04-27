import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Clock, Plane, Users, MapPin, AlertTriangle, Plus, Trash2, Briefcase, Search, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { fetchFlightPlanEntries, getFlightCodeMatchKeys, normalizeFlightCode } from "@/lib/flight-plan";
import { triggerServicePushNotification } from "@/lib/notifications";
import { triggerGoogleSheetsSync } from "@/lib/google-sheets-sync";
import { buildServiceNotesWithAssignedStaff, extractAssignedStaffFromService, getVisibleServiceNotes, isAssignedStaffSchemaCacheError } from "@/lib/wheelchair-service-utils";
import { matchesWheelchairInventoryTerminal } from "@/lib/wheelchair-terminals";
import { toast } from "sonner";
import AddServiceDialog from "@/components/AddServiceDialog";

interface Flight {
  airline_iata: string;
  flight_iata: string;
  flight_number: string;
  dep_iata: string;
  dep_terminal: string | null;
  dep_gate: string | null;
  dep_time: string;
  dep_time_ts: number;
  dep_estimated?: string;
  dep_estimated_ts?: number;
  arr_iata: string;
  plannedPosition?: string;
  parkPosition?: string;
  status: string;
  duration: number;
  delayed?: number;
}

interface WheelchairService {
  assigned_staff: string;
  id: string;
  flight_iata: string;
  wheelchair_id: string;
  passenger_type: 'STEP' | 'RAMP' | 'CABIN';
  notes: string;
  terminal: string;
  created_at: string;
  created_by: string;
}

interface WheelchairInventory {
  id: string;
  wheelchair_id: string;
  status: string;
  terminal: string;
}

const TERMINALS = ["T1", "T2"] as const;
const TERMINAL_LABELS: Record<(typeof TERMINALS)[number], string> = {
  T1: "Ic Hat",
  T2: "T2",
};
const COUNTER_CLOSE_MINUTES: Record<(typeof TERMINALS)[number], number> = {
  T1: 45,
  T2: 60,
};
const PRE_FLIGHT_ALERT_WINDOW_MINUTES = 2;
const DOMESTIC_AIRPORT_CODES = new Set([
  "ADA", "ADB", "ADF", "AJI", "AOE", "ASR", "AYT", "BAL", "BDM", "BJV", "CKZ", "DIY", "DLM", "DNZ", "EDO", "EZS",
  "ERC", "ERZ", "ESB", "GNY", "GZP", "GZT", "HTY", "IGD", "ISE", "IST", "IZM", "KCM", "KCO", "KSY", "KYA", "MLX",
  "MQM", "MSR", "MZH", "NAV", "NOP", "OGU", "ONQ", "RIZ", "SAW", "SFQ", "SIC", "SZF", "TEQ", "TJK", "TZX", "USQ",
  "VAN", "YEI", "YKO", "BXN",
]);

const extractAirlineCodeFromFlightCode = (value: string) => {
  const match = normalizeFlightCode(value).match(/^[A-Z0-9]+?(?=\d|$)/);
  return match?.[0] || "";
};

const extractFlightNumberFromFlightCode = (value: string) => {
  const normalized = normalizeFlightCode(value);
  const airlineCode = extractAirlineCodeFromFlightCode(normalized);
  return normalized.slice(airlineCode.length);
};

const parseDepartureTimestamp = (value: string) => {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return null;
  }

  const now = new Date();
  const parsed = new Date(now);
  parsed.setHours(Number(match[1]), Number(match[2]), Number(match[3] || 0), 0);
  return Math.floor(parsed.getTime() / 1000);
};

const normalizeGateValue = (value?: string | null) => {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized || normalized === "0" || normalized === "00" || normalized === "-") {
    return null;
  }

  return normalized;
};

const getTerminalFromDestination = (destinationIata?: string | null) => {
  const normalized = String(destinationIata || "").trim().toUpperCase();
  return DOMESTIC_AIRPORT_CODES.has(normalized) ? "T1" : "T2";
};

const getDisplayGate = (flight?: Pick<Flight, "plannedPosition" | "dep_gate" | "parkPosition"> | null) => {
  if (!flight) {
    return "-";
  }

  return normalizeGateValue(flight.plannedPosition)
    || normalizeGateValue(flight.parkPosition)
    || normalizeGateValue(flight.dep_gate)
    || "-";
};

const WheelchairServicesPage = () => {
  const navigate = useNavigate();
  const [flights, setFlights] = useState<Flight[]>([]);
  const [services, setServices] = useState<WheelchairService[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState("T1");
  const [selectedFlight, setSelectedFlight] = useState<Flight | null>(null);
  const [showServiceDialog, setShowServiceDialog] = useState(false);
  const [wheelchairs, setWheelchairs] = useState<WheelchairInventory[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentUser, setCurrentUser] = useState("Personel");
  const sentPreFlightAlertsRef = useRef<Set<string>>(new Set());

  const resolveFlightTerminal = (flight: Flight) => getTerminalFromDestination(flight.arr_iata);

  const fetchFlights = async (silent = false) => {
    if (!silent) {
      setRefreshing(true);
    }

    try {
      const flightPlanEntries = await fetchFlightPlanEntries();
      const now = Date.now() / 1000;

      const mappedFlights = flightPlanEntries
        .filter((entry) => Boolean(entry.departureCode))
        .map((entry) => {
          const flightCode = normalizeFlightCode(entry.departureCode || "");
          const airlineCode = extractAirlineCodeFromFlightCode(flightCode);
          const flightNumber = extractFlightNumberFromFlightCode(flightCode);
          const departureTimestamp = parseDepartureTimestamp(entry.departureTime);

          return {
            airline_iata: airlineCode,
            flight_iata: flightCode,
            flight_number: flightNumber,
            dep_iata: "AYT",
            dep_terminal: getTerminalFromDestination(entry.departureIATA),
            dep_gate: entry.parkPosition || null,
            dep_time: entry.departureTime || "",
            dep_time_ts: departureTimestamp || 0,
            dep_estimated: undefined,
            dep_estimated_ts: undefined,
            arr_iata: entry.departureIATA || "",
            plannedPosition: entry.parkPosition || undefined,
            parkPosition: entry.parkPosition || undefined,
            status: entry.specialNotes ? "noted" : "scheduled",
            duration: 0,
            delayed: undefined,
          } satisfies Flight;
        })
        .filter((flight) => flight.dep_time_ts > 0);

      const activeFlights = mappedFlights
        .filter((flight: Flight) => (flight.dep_estimated_ts || flight.dep_time_ts) > now)
        .sort((left: Flight, right: Flight) => {
          const leftTime = left.dep_estimated_ts || left.dep_time_ts;
          const rightTime = right.dep_estimated_ts || right.dep_time_ts;
          return leftTime - rightTime;
        });

      setFlights(activeFlights);
    } catch (error) {
      console.error("Flights fetch failed:", error);
      toast.error("Uçuş verileri alınamadı");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchServices = async () => {
    const { data } = await supabase
      .from("wheelchair_services")
      .select("*")
      .order("created_at", { ascending: false });

    if (data) {
      setServices(data as WheelchairService[]);
    }
  };

  const fetchWheelchairs = async () => {
    const { data } = await supabase
      .from("wheelchairs")
      .select("id, wheelchair_id, status, terminal");

    if (data) {
      setWheelchairs(data as WheelchairInventory[]);
    }
  };

  useEffect(() => {
    if (flights.length === 0 || services.length === 0) {
      return;
    }

    const nowSeconds = Date.now() / 1000;
    const serviceKeys = services.map((service) => ({
      service,
      keys: new Set<string>(getFlightCodeMatchKeys(service.flight_iata || "")),
    }));

    flights.forEach((flight) => {
      const depTime = flight.dep_estimated_ts || flight.dep_time_ts;
      const terminal = resolveFlightTerminal(flight);
      if (!terminal) {
        return;
      }

      const thresholdMinutes = COUNTER_CLOSE_MINUTES[terminal];
      const remainingMinutes = (depTime - nowSeconds) / 60;
      const alertKey = `${flight.flight_iata}|${depTime}|${thresholdMinutes}`;

      if (sentPreFlightAlertsRef.current.has(alertKey)) {
        return;
      }

      if (!(remainingMinutes <= thresholdMinutes && remainingMinutes > thresholdMinutes - PRE_FLIGHT_ALERT_WINDOW_MINUTES)) {
        return;
      }

      const flightKeys = new Set<string>([
        ...getFlightCodeMatchKeys(flight.flight_iata || ""),
        ...getFlightCodeMatchKeys(`${flight.airline_iata || ""}${flight.flight_number || ""}`),
        ...getFlightCodeMatchKeys(flight.flight_number || ""),
      ]);

      const relatedServices = serviceKeys
        .filter(({ service, keys }) => {
          if (service.terminal !== terminal) {
            return false;
          }

          return Array.from(keys).some((key) => flightKeys.has(key));
        })
        .map(({ service }) => service);

      if (relatedServices.length === 0) {
        return;
      }

      const passengerTypeCount = relatedServices.reduce<Record<string, number>>((accumulator, service) => {
        accumulator[service.passenger_type] = (accumulator[service.passenger_type] || 0) + 1;
        return accumulator;
      }, {});
      const specialNotesCount = relatedServices.filter((service) => Boolean(getVisibleServiceNotes(service.notes))).length;

      const passengerSummary = Object.entries(passengerTypeCount)
        .map(([type, count]) => `${type}:${count}`)
        .join(" • ");
      const noteSummary = specialNotesCount > 0 ? ` • Özel durum/not: ${specialNotesCount}` : "";
      const detail = `Kalkışa ${thresholdMinutes} dk kaldı • Toplam hizmet: ${relatedServices.length} • ${passengerSummary}${noteSummary}`;

      sentPreFlightAlertsRef.current.add(alertKey);
      void triggerServicePushNotification({
        assigned_staff: "Sistem",
        created_at: new Date().toISOString(),
        created_by: currentUser,
        flight_iata: flight.flight_iata,
        notes: detail,
        passenger_type: "BILDIRIM",
        terminal,
        wheelchair_id: `TOPLAM-${relatedServices.length}`,
      }).catch((pushError) => {
        sentPreFlightAlertsRef.current.delete(alertKey);
        console.error("Pre-flight service summary push failed:", pushError);
      });
    });
  }, [currentUser, flights, services]);

  useEffect(() => {
    const user = localStorage.getItem("userName");
    if (user) {
      setCurrentUser(user);
    }

    fetchFlights();
    fetchServices();
    fetchWheelchairs();

    const handleServiceRealtime = (payload: RealtimePostgresChangesPayload<WheelchairService>) => {
      if (payload.eventType === "INSERT") {
        const nextService = payload.new as WheelchairService;
        setServices((prev) => {
          if (prev.some((service) => service.id === nextService.id)) {
            return prev;
          }

          return [nextService, ...prev].sort((left, right) =>
            new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
          );
        });
        return;
      }

      if (payload.eventType === "UPDATE") {
        const updatedService = payload.new as WheelchairService;
        setServices((prev) => prev.map((service) =>
          service.id === updatedService.id ? updatedService : service,
        ));
        return;
      }

      if (payload.eventType === "DELETE") {
        const deletedService = payload.old as WheelchairService;
        setServices((prev) => prev.filter((service) => service.id !== deletedService.id));
      }
    };

    const servicesChannel = supabase
      .channel("wheelchair_services_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "wheelchair_services" }, handleServiceRealtime)
      .subscribe();

    const wheelchairsChannel = supabase
      .channel("wheelchairs_services_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "wheelchairs" }, () => {
        fetchWheelchairs();
      })
      .subscribe();

    const interval = setInterval(() => fetchFlights(true), 60000);
    return () => {
      clearInterval(interval);
      supabase.removeChannel(servicesChannel);
      supabase.removeChannel(wheelchairsChannel);
    };
  }, []);

  const formatTime = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleTimeString('tr-TR', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getTimeRemaining = (timestamp: number) => {
    const now = Date.now() / 1000;
    const diff = timestamp - now;
    if (diff <= 0) return "Geçti";
    if (diff < 60) return "<1dk";

    const hours = Math.floor(diff / 3600);
    const minutes = Math.floor((diff % 3600) / 60);

    if (hours > 0) {
      return `${hours}s ${minutes}dk`;
    }
    return `${minutes}dk`;
  };

  const isCounterClosed = (terminal: (typeof TERMINALS)[number], timestamp: number) => {
    const now = Date.now() / 1000;
    const diffMinutes = (timestamp - now) / 60;
    return diffMinutes <= COUNTER_CLOSE_MINUTES[terminal];
  };

  const getTerminalFlights = (terminal: string) => {
    return flights.filter((flight) => resolveFlightTerminal(flight) === terminal);
  };

  const handleAddService = async (flight: Flight, wheelchairId: string, passengerType: string, notes: string, assignedStaff: string) => {
    try {
      const cleanNotes = notes.trim();
      const insertPayload = {
        assigned_staff: assignedStaff,
        flight_iata: flight.flight_iata,
        wheelchair_id: wheelchairId,
        passenger_type: passengerType,
        notes: cleanNotes,
        terminal: activeTab,
        created_by: currentUser,
      };

      const { error } = await supabase.from("wheelchair_services").insert(insertPayload);

      if (error) {
        if (!isAssignedStaffSchemaCacheError(error)) {
          throw error;
        }

        const fallbackNotes = buildServiceNotesWithAssignedStaff(cleanNotes, assignedStaff);
        const { error: fallbackError } = await supabase.from("wheelchair_services").insert({
          flight_iata: flight.flight_iata,
          wheelchair_id: wheelchairId,
          passenger_type: passengerType,
          notes: fallbackNotes,
          terminal: activeTab,
          created_by: currentUser,
        });

        if (fallbackError) {
          throw fallbackError;
        }

        toast.success(`${flight.flight_iata} için hizmet eklendi. Personel bilgisi geçici olarak not alanında saklandı.`);
      } else {
        toast.success(`${flight.flight_iata} için hizmet eklendi`);
      }

      await supabase.from("action_logs").insert({
        wheelchair_id: wheelchairId,
        action: "Hizmet Eklendi",
        details: `${flight.flight_iata} • ${passengerType} • Atanan: ${assignedStaff}${cleanNotes ? ` • ${cleanNotes}` : ""}`,
        performed_by: currentUser,
      });

      void triggerServicePushNotification({
        assigned_staff: assignedStaff,
        created_at: new Date().toISOString(),
        created_by: currentUser,
        flight_iata: flight.flight_iata,
        notes: cleanNotes,
        passenger_type: passengerType,
        terminal: activeTab,
        wheelchair_id: wheelchairId,
      }).catch((pushError) => {
        console.error("Service push notification failed:", pushError);
      });

      fetchServices();
      void fetchFlights(true);
      setShowServiceDialog(false);

      // Sheets sync — güncel hizmetleri çekip gönder
      void (async () => {
        try {
          const [flightPlanEntries, { data: allServices }, { data: wheelchairRows }] = await Promise.all([
            fetchFlightPlanEntries(),
            supabase.from("wheelchair_services").select("*").order("created_at", { ascending: false }),
            supabase.from("wheelchairs").select("terminal, status"),
          ]);

          const flightLookup = new Map<string, (typeof flightPlanEntries)[0]>();
          flightPlanEntries.filter(e => e.departureCode).forEach(e => {
            getFlightCodeMatchKeys(e.departureCode).forEach(k => { if (!flightLookup.has(k)) flightLookup.set(k, e); });
          });

          const specialServices = (allServices || []).map((svc) => {
            const matched = getFlightCodeMatchKeys(svc.flight_iata || "").map(k => flightLookup.get(k)).find(Boolean);
            return {
              createdAt: svc.created_at,
              flightCode: normalizeFlightCode(svc.flight_iata || ""),
              airline: matched ? extractAirlineCodeFromFlightCode(matched.departureCode) : extractAirlineCodeFromFlightCode(svc.flight_iata || ""),
              destination: matched?.departureIATA || "",
              terminal: svc.terminal || "",
              gate: matched?.parkPosition || "",
              passengerType: svc.passenger_type || "",
              assignedStaff: extractAssignedStaffFromService(svc) || "",
              createdBy: svc.created_by || "",
              wheelchairId: svc.wheelchair_id || "",
              specialNotes: getVisibleServiceNotes(svc.notes) || "-",
            };
          });

          const departures = flightPlanEntries.filter(e => e.departureCode).map(e => ({
            updatedAt: new Date().toISOString(),
            departureTime: e.departureTime || "",
            airline: extractAirlineCodeFromFlightCode(e.departureCode),
            flightCode: normalizeFlightCode(e.departureCode),
            destination: e.departureIATA || "",
            terminal: "",
            gate: e.parkPosition || "",
            status: e.specialNotes ? "noted" : "scheduled",
            delayMinutes: 0,
            plannedPosition: e.parkPosition || "",
          }));

          const invMap = new Map<string, { available: number; missing: number; maintenance: number }>();
          (wheelchairRows || []).forEach(r => {
            const t = (r.terminal || "GENEL").trim() || "GENEL";
            const cur = invMap.get(t) || { available: 0, missing: 0, maintenance: 0 };
            if (r.status === "missing") cur.missing += 1;
            else if (r.status === "maintenance") cur.maintenance += 1;
            else cur.available += 1;
            invMap.set(t, cur);
          });
          const inventorySummary = Array.from(invMap.entries()).sort((a, b) => a[0].localeCompare(b[0], "tr")).map(([t, c]) => ({ updatedAt: new Date().toISOString(), terminal: t, ...c }));

          await triggerGoogleSheetsSync({ departures, specialServices, inventorySummary, handovers: [] });
        } catch (syncErr) {
          console.error("Post-add Sheets sync failed:", syncErr);
        }
      })();
    } catch (error: any) {
      toast.error("Hizmet eklenemedi: " + error.message);
    }
  };

  const handleDeleteService = async (serviceId: string, flightIata: string) => {
    const confirmed = window.confirm(`${flightIata} hizmetini silmek istediğinizden emin misiniz?`);
    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from("wheelchair_services")
        .delete()
        .eq("id", serviceId);

      if (error) throw error;

      const service = services.find((item) => item.id === serviceId);
      if (service) {
        await supabase.from("action_logs").insert({
          wheelchair_id: service.wheelchair_id,
          action: "Hizmet Silindi",
          details: `${service.flight_iata} • ${service.passenger_type}`,
          performed_by: currentUser,
        });
      }

      toast.success(`${flightIata} hizmeti silindi`);
      fetchServices();
    } catch (error: any) {
      toast.error("Hizmet silinemedi: " + error.message);
    }
  };

  const filteredFlights = getTerminalFlights(activeTab);
  const flightLookup = useMemo(() => {
    const lookup = new Map<string, Flight>();

    flights.forEach((flight) => {
      const keys = new Set<string>([
        ...getFlightCodeMatchKeys(flight.flight_iata || ""),
        ...getFlightCodeMatchKeys(`${flight.airline_iata || ""}${flight.flight_number || ""}`),
        ...getFlightCodeMatchKeys(flight.flight_number || ""),
      ]);

      keys.forEach((key) => {
        if (key) {
          lookup.set(key, flight);
        }
      });
    });

    return lookup;
  }, [flights]);
  const terminalServices = services.filter((service) => {
    if (service.terminal !== activeTab) {
      return false;
    }

    const serviceKeys = getFlightCodeMatchKeys(service.flight_iata || "");
    return serviceKeys.some((key) => flightLookup.has(key));
  });
  const terminalWheelchairs = wheelchairs.filter((wheelchair) =>
    matchesWheelchairInventoryTerminal(activeTab, wheelchair.terminal),
  );
  const availableWheelchairCount = terminalWheelchairs.filter((wheelchair) => wheelchair.status === "available").length;
  const missingWheelchairCount = terminalWheelchairs.filter((wheelchair) => wheelchair.status === "missing").length;
  const urgentFlightsCount = filteredFlights.filter((flight) => {
    const depTime = flight.dep_estimated_ts || flight.dep_time_ts;
    return depTime - (Date.now() / 1000) < 3600;
  }).length;

  const filteredServices = terminalServices.filter((service) => {
    const query = searchQuery.trim().toLocaleLowerCase("tr");
    if (!query) return true;

    const assignedStaff = extractAssignedStaffFromService(service);
    const visibleNotes = getVisibleServiceNotes(service.notes);

    return [service.flight_iata, service.wheelchair_id, service.passenger_type, visibleNotes, service.created_by]
      .concat(assignedStaff)
      .join(" ")
      .toLocaleLowerCase("tr")
      .includes(query);
  });

  const filteredFlightsBySearch = filteredFlights.filter((flight) => {
    const query = searchQuery.trim().toLocaleLowerCase("tr");
    if (!query) return true;

    return [flight.flight_iata, flight.flight_number, flight.arr_iata, flight.dep_gate, flight.airline_iata]
      .join(" ")
      .toLocaleLowerCase("tr")
      .includes(query);
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-30">
        <div className="container flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <Users className="w-4 h-4 text-primary" />
            </div>
            <h1 className="font-heading font-bold text-lg">Tekerlekli Sandalye Hizmetleri</h1>
          </div>
        </div>
      </header>

      <main className="container px-4 py-6">
        <div className="flex flex-col gap-3 mb-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 flex-1">
            <Card>
              <CardContent className="py-4">
                <p className="text-xs text-muted-foreground">Aktif Hizmet</p>
                <p className="text-2xl font-heading font-bold">{terminalServices.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <p className="text-xs text-muted-foreground">Müsait Sandalye</p>
                <p className="text-2xl font-heading font-bold text-primary">{availableWheelchairCount}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <p className="text-xs text-muted-foreground">Eksik Sandalye</p>
                <p className="text-2xl font-heading font-bold text-destructive">{missingWheelchairCount}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <p className="text-xs text-muted-foreground">1 Saat İçindeki Uçuş</p>
                <p className="text-2xl font-heading font-bold text-orange-600">{urgentFlightsCount}</p>
              </CardContent>
            </Card>
          </div>

          <div className="flex gap-2 lg:w-[360px]">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Uçuş, sandalye, yolcu tipi ara..."
                className="pl-9"
              />
            </div>
            <Button variant="outline" onClick={() => fetchFlights()} disabled={refreshing}>
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-secondary mb-6 rounded-xl border border-border shadow-sm">
            {TERMINALS.map((t) => (
              <TabsTrigger
                key={t}
                value={t}
                className="font-heading data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg"
              >
                {TERMINAL_LABELS[t]}
              </TabsTrigger>
            ))}
          </TabsList>

          {TERMINALS.map((terminal) => (
            <TabsContent key={terminal} value={terminal}>
              <div className="space-y-6">
                {/* Active Services */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Briefcase className="w-5 h-5 text-primary" />
                    <h3 className="font-heading font-semibold">Aktif Hizmetler</h3>
                  </div>
                  {filteredServices.length === 0 ? (
                    <Card>
                      <CardContent className="py-8 text-center text-muted-foreground">
                        <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        <p>{terminalServices.length === 0 ? "Bu terminalde aktif hizmet yok" : "Aramaya uygun hizmet bulunamadi"}</p>
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="space-y-2">
                      {filteredServices.map((service) => (
                        <Card key={service.id} className="border-l-4 border-l-primary/70 bg-slate-50 hover:shadow-sm transition-shadow">
                          <CardContent className="py-3">
                            {(() => {
                              const relatedFlight = getFlightCodeMatchKeys(service.flight_iata || "")
                                .map((key) => flightLookup.get(key))
                                .find(Boolean);
                              const assignedStaff = extractAssignedStaffFromService(service);
                              const visibleNotes = getVisibleServiceNotes(service.notes);

                              return (
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-3 flex-1 min-w-0">
                                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                                  <Briefcase className="w-4 h-4 text-primary" />
                                </div>
                                <div className="min-w-0">
                                  <p className="font-medium truncate">{service.flight_iata}</p>
                                  <p className="text-sm text-muted-foreground">
                                    {service.wheelchair_id} • {service.passenger_type}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    Atanan: {assignedStaff || "Belirtilmedi"}
                                  </p>
                                  {relatedFlight && (relatedFlight.dep_gate || relatedFlight.parkPosition || relatedFlight.plannedPosition) ? (
                                    <p className="text-xs text-muted-foreground">
                                      {`Gate ${getDisplayGate(relatedFlight)}`}
                                    </p>
                                  ) : null}
                                  <p className="text-xs text-muted-foreground">
                                    Kaydeden: {service.created_by || "Personel"}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <div className="text-right">
                                  <p className="text-xs font-mono">
                                    {new Date(service.created_at).toLocaleTimeString('tr-TR', {
                                      hour: '2-digit',
                                      minute: '2-digit'
                                    })}
                                  </p>
                                  {visibleNotes && (
                                    <p className="text-xs text-muted-foreground truncate max-w-28">
                                      {visibleNotes}
                                    </p>
                                  )}
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDeleteService(service.id, service.flight_iata)}
                                  className="text-red-600 hover:text-red-700 hover:bg-red-50/50 ml-1"
                                  title="Hizmeti sil"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                              );
                            })()}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>

                {/* Available Flights */}
                <div>
                  <h3 className="font-heading font-semibold mb-3">Kullanılabilir Uçuşlar</h3>
                  {loading ? (
                    <div className="text-center py-16 text-muted-foreground">
                      Uçuş verileri yükleniyor...
                    </div>
                  ) : filteredFlightsBySearch.length === 0 ? (
                    <div className="text-center py-16 text-muted-foreground">
                      <Plane className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <p>{filteredFlights.length === 0 ? "Bu terminalde aktif uçuş yok" : "Aramaya uygun uçuş bulunamadi"}</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {filteredFlightsBySearch.map((flight) => {
                        const depTime = flight.dep_estimated_ts || flight.dep_time_ts;
                        const timeRemaining = getTimeRemaining(depTime);
                        const isUrgent = depTime - (Date.now() / 1000) < 3600; // Less than 1 hour
                        const counterClosed = isCounterClosed(terminal, depTime);

                        return (
                          <Card
                            key={flight.flight_iata}
                            className={`transition-all duration-200 rounded-2xl overflow-hidden ${
                              isUrgent
                                ? 'border-2 border-red-500 bg-gradient-to-r from-red-50/80 to-orange-50/80 shadow-md shadow-red-100'
                                : 'border border-slate-200 bg-card hover:border-primary/40 hover:shadow-lg'
                            }`}
                          >
                            <CardHeader className="pb-2">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex items-start gap-3 flex-1">
                                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${isUrgent ? 'bg-red-100' : 'bg-primary/10'}`}>
                                    <Plane className={`w-5 h-5 ${isUrgent ? 'text-red-600' : 'text-primary'}`} />
                                  </div>
                                  <div className="min-w-0">
                                    <CardTitle className={`text-base font-heading truncate ${isUrgent ? 'text-red-700' : ''}`}>
                                      {flight.airline_iata} {flight.flight_number}
                                    </CardTitle>
                                    <p className={`text-xs ${isUrgent ? 'text-red-600' : 'text-muted-foreground'}`}>
                                      {flight.dep_iata} → {flight.arr_iata}
                                    </p>
                                  </div>
                                </div>
                                <div className="text-right flex-shrink-0">
                                  <div className={`text-sm font-mono font-bold ${isUrgent ? 'text-red-700' : 'text-foreground'}`}>
                                    {formatTime(depTime)}
                                  </div>
                                  <div className="mt-1 flex flex-col items-end gap-1">
                                    <Badge
                                      className={`text-xs font-semibold ${
                                        isUrgent
                                          ? 'bg-red-600 text-white hover:bg-red-700'
                                          : 'bg-blue-100 text-blue-800 hover:bg-blue-200'
                                      }`}
                                    >
                                      {timeRemaining}
                                    </Badge>
                                    {counterClosed && (
                                      <Badge className="bg-slate-900 text-white hover:bg-slate-800 text-[11px]">
                                        Kontuar Kapali
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </CardHeader>
                            <CardContent className="pt-0">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-3 text-xs">
                                  <div className="flex items-center gap-1">
                                    <MapPin className={`w-3 h-3 ${isUrgent ? 'text-red-600' : 'text-muted-foreground'}`} />
                                    <span className={isUrgent ? 'text-red-700 font-medium' : 'text-muted-foreground'}>
                                      Gate {getDisplayGate(flight)}
                                    </span>
                                  </div>
                                  {flight.delayed && flight.delayed > 0 && (
                                    <div className="flex items-center gap-1 text-orange-600 font-medium">
                                      <AlertTriangle className="w-3 h-3" />
                                      <span>+{flight.delayed}m</span>
                                    </div>
                                  )}
                                </div>
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    setSelectedFlight(flight);
                                    setShowServiceDialog(true);
                                  }}
                                  className={`gap-1 text-xs ${
                                    isUrgent
                                      ? 'bg-red-600 hover:bg-red-700 text-white'
                                      : ''
                                  }`}
                                >
                                  <Plus className="w-3 h-3" />
                                  Ekle
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </main>

      {/* Service Dialog */}
      <AddServiceDialog
        open={showServiceDialog}
        onOpenChange={setShowServiceDialog}
        flight={selectedFlight}
        terminal={activeTab}
        onConfirm={handleAddService}
        onServiceAdded={fetchServices}
      />
    </div>
  );
};

export default WheelchairServicesPage;