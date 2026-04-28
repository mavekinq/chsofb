import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, Clock, Plane, Users, MapPin, AlertTriangle, Plus, Trash2,
  Search, RefreshCw, Accessibility, Activity, X, ChevronDown, ChevronUp,
  MessageSquare, Pencil, Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { fetchFlightPlanEntriesMerged, fetchFlightPlanEntriesMergedWithWindow, getFlightCodeMatchKeys, getIstanbulDateKey, normalizeFlightCode } from "@/lib/flight-plan";
import { triggerServicePushNotification } from "@/lib/notifications";
import { triggerGoogleSheetsSync } from "@/lib/google-sheets-sync";
import { buildDeparturesPayload, buildFlightLookup, buildInventorySummaryPayload, buildSpecialServicesPayload } from "@/lib/google-sheets-payload";
import { buildServiceNotesWithAssignedStaff, extractAssignedStaffFromService, getVisibleServiceNotes, isAssignedStaffSchemaCacheError } from "@/lib/wheelchair-service-utils";
import { matchesWheelchairInventoryTerminal } from "@/lib/wheelchair-terminals";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import AddServiceDialog from "@/components/AddServiceDialog";

// ─── Types ─────────────────────────────────────────────────────────────────

interface Flight {
  airline_iata: string;
  flight_iata: string;
  flight_number: string;
  list_order: number;
  dep_day_offset: number;
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
  passenger_type: "STEP" | "RAMP" | "CABIN";
  notes: string;
  terminal: string;
  created_at: string;
  created_by: string;
}

type EditableServiceTarget = {
  id: string;
  wheelchair_id: string;
  passenger_type: "STEP" | "RAMP" | "CABIN";
  notes: string;
  assigned_staff: string;
  flight_iata: string;
};

interface WheelchairInventory {
  id: string;
  wheelchair_id: string;
  status: string;
  terminal: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const TERMINALS = ["T1", "T2"] as const;
const TERMINAL_LABELS: Record<(typeof TERMINALS)[number], string> = {
  T1: "İç Hat",
  T2: "T2",
};
const COUNTER_CLOSE_MINUTES: Record<(typeof TERMINALS)[number], number> = {
  T1: 45,
  T2: 60,
};
const PRE_FLIGHT_ALERT_WINDOW_MINUTES = 2;
const SERVICE_COMPLETED_TAG = "[HIZMET_TAMAMLANDI]";

const PASSENGER_TYPE_STYLES: Record<string, { badge: string; label: string }> = {
  STEP: { badge: "bg-blue-100 text-blue-800 border-blue-200", label: "STEP · Merdiven" },
  RAMP: { badge: "bg-green-100 text-green-800 border-green-200", label: "RAMP · Rampa" },
  CABIN: { badge: "bg-purple-100 text-purple-800 border-purple-200", label: "CABIN · Kabin" },
};

const DOMESTIC_AIRPORT_CODES = new Set([
  "ADA", "ADB", "ADF", "AJI", "AOE", "ASR", "AYT", "BAL", "BDM", "BJV", "CKZ", "DIY", "DLM", "DNZ", "EDO", "EZS",
  "COV", "ERC", "ERZ", "ESB", "GNY", "GZP", "GZT", "HTY", "IGD", "ISE", "IST", "IZM", "KCM", "KCO", "KSY", "KYA", "MLX",
  "MQM", "MSR", "MZH", "NAV", "NOP", "OGU", "ONQ", "RIZ", "SAW", "SFQ", "SIC", "SZF", "TEQ", "TJK", "TZX", "USQ",
  "VAN", "YEI", "YKO", "BXN",
]);

// ─── Helpers ────────────────────────────────────────────────────────────────

const extractAirlineCode = (value: string) => {
  const match = normalizeFlightCode(value).match(/^[A-Z0-9]+?(?=\d|$)/);
  return match?.[0] || "";
};

const extractFlightNumber = (value: string) => {
  const normalized = normalizeFlightCode(value);
  const airlineCode = extractAirlineCode(normalized);
  return normalized.slice(airlineCode.length);
};

const parseDepartureMinutes = (value: string) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
};

const getIstanbulDateParts = (value = new Date()) => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const [year, month, day] = formatter.format(value).split("-").map(Number);
  return { year, month, day };
};

const getIstanbulNowSeconds = () => Math.floor(Date.now() / 1000);

const buildIstanbulTimestamp = (minutes: number, dayOffset = 0) => {
  const { year, month, day } = getIstanbulDateParts();
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const istanbulOffsetHours = 3;
  return Math.floor(Date.UTC(year, (month || 1) - 1, (day || 1) + dayOffset, hours - istanbulOffsetHours, mins, 0) / 1000);
};

const buildDepartureTimestamps = (
  entries: Array<{ departureTime: string }>,
  liveWindowStartMinutes: number | null,
  liveWindowEndMinutes: number | null,
  crossesMidnight: boolean,
) => {
  return entries.map((entry) => {
    const minutes = parseDepartureMinutes(entry.departureTime);
    if (minutes === null) return null;
    const dayOffset = crossesMidnight && liveWindowEndMinutes !== null && liveWindowStartMinutes !== null && minutes <= liveWindowEndMinutes
      ? 1
      : 0;
    return buildIstanbulTimestamp(minutes, dayOffset);
  });
};

const getDepartureDayOffset = (
  departureTime: string,
  liveWindowStartMinutes: number | null,
  liveWindowEndMinutes: number | null,
  crossesMidnight: boolean,
) => {
  const minutes = parseDepartureMinutes(departureTime);
  if (minutes === null) return 0;
  return crossesMidnight && liveWindowEndMinutes !== null && liveWindowStartMinutes !== null && minutes <= liveWindowEndMinutes
    ? 1
    : 0;
};

const normalizeGateValue = (value?: string | null) => {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized || normalized === "0" || normalized === "00" || normalized === "-") return null;
  return normalized;
};

const getTerminalFromDestination = (destinationIata?: string | null) => {
  const normalized = String(destinationIata || "").trim().toUpperCase();
  return DOMESTIC_AIRPORT_CODES.has(normalized) ? "T1" : "T2";
};

const getDisplayGate = (flight?: Pick<Flight, "plannedPosition" | "dep_gate" | "parkPosition"> | null) => {
  if (!flight) return "-";
  return (
    normalizeGateValue(flight.plannedPosition) ||
    normalizeGateValue(flight.parkPosition) ||
    normalizeGateValue(flight.dep_gate) ||
    "-"
  );
};

const isServiceCompleted = (service: Pick<WheelchairService, "notes">) =>
  String(service.notes || "").includes(SERVICE_COMPLETED_TAG);

const markServiceAsCompleted = (notes: string) => {
  if (String(notes || "").includes(SERVICE_COMPLETED_TAG)) return String(notes || "").trim();
  const clean = String(notes || "").trim();
  return clean ? `${clean}\n${SERVICE_COMPLETED_TAG}` : SERVICE_COMPLETED_TAG;
};

const removeCompletedTag = (notes: string) =>
  String(notes || "")
    .replace(SERVICE_COMPLETED_TAG, "")
    .replace(/\n{2,}/g, "\n")
    .trim();

// ─── Sub-components ─────────────────────────────────────────────────────────

const StatCard = ({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: number | string;
  color?: string;
  icon?: React.ReactNode;
}) => (
  <Card className="border-border/60">
    <CardContent className="py-3 px-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{label}</p>
          <p className={cn("text-2xl font-heading font-bold mt-0.5", color)}>{value}</p>
        </div>
        {icon && (
          <div className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center text-muted-foreground flex-shrink-0">
            {icon}
          </div>
        )}
      </div>
    </CardContent>
  </Card>
);

const FlightCardSkeleton = () => (
  <Card className="border-border/60">
    <CardContent className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1">
          <Skeleton className="w-10 h-10 rounded-xl flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-5 w-16" />
        </div>
      </div>
      <div className="flex items-center justify-between mt-3">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-8 w-20 rounded-lg" />
      </div>
    </CardContent>
  </Card>
);

const ServiceCardSkeleton = () => (
  <Card className="border-border/60">
    <CardContent className="py-3 px-4">
      <div className="flex items-center gap-3">
        <Skeleton className="w-8 h-8 rounded-lg flex-shrink-0" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3 w-36" />
        </div>
        <Skeleton className="h-3 w-10" />
      </div>
    </CardContent>
  </Card>
);

// ─── Main Component ─────────────────────────────────────────────────────────

const WheelchairServicesPage = () => {
  const navigate = useNavigate();
  const [flights, setFlights] = useState<Flight[]>([]);
  const [services, setServices] = useState<WheelchairService[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState("T1");
  const [selectedFlight, setSelectedFlight] = useState<Flight | null>(null);
  const [showServiceDialog, setShowServiceDialog] = useState(false);
  const [editingService, setEditingService] = useState<EditableServiceTarget | null>(null);
  const [wheelchairs, setWheelchairs] = useState<WheelchairInventory[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentUser, setCurrentUser] = useState("Personel");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; flightIata: string } | null>(null);
  const [expandedServices, setExpandedServices] = useState<Set<string>>(new Set());
  const sentPreFlightAlertsRef = useRef<Set<string>>(new Set());

  // ── Flight notes (localStorage, per-day) ──
  const todayKey = getIstanbulDateKey();
  const NOTES_STORAGE_KEY = `ww-flight-notes-${todayKey}`;
  const [flightNotes, setFlightNotes] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem(NOTES_STORAGE_KEY) || "{}"); } catch { return {}; }
  });
  const [noteDialog, setNoteDialog] = useState<{ flightIata: string; value: string } | null>(null);

  const saveFlightNote = (flightIata: string, note: string) => {
    const updated = { ...flightNotes, [flightIata]: note };
    setFlightNotes(updated);
    localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(updated));
  };

  const clearFlightNote = (flightIata: string) => {
    const { [flightIata]: _, ...rest } = flightNotes;
    setFlightNotes(rest);
    localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(rest));
  };

  // ── Helpers ──

  const resolveFlightTerminal = (flight: Flight) => {
    if (flight.dep_terminal === "T1" || flight.dep_terminal === "T2") return flight.dep_terminal;
    return getTerminalFromDestination(flight.arr_iata);
  };

  const formatFlightTime = (flight: Flight) => {
    const rawTime = String(flight.dep_estimated || flight.dep_time || "").trim();
    const parsedMinutes = parseDepartureMinutes(rawTime);
    if (parsedMinutes !== null) {
      const hours = Math.floor(parsedMinutes / 60).toString().padStart(2, "0");
      const minutes = (parsedMinutes % 60).toString().padStart(2, "0");
      return `${hours}:${minutes}`;
    }
    const timestamp = flight.dep_estimated_ts || flight.dep_time_ts;
    if (timestamp <= 0) return "-";
    return new Date(timestamp * 1000).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  };

  const getTimeRemaining = (timestamp: number) => {
    if (timestamp <= 0) return null;
    const now = getIstanbulNowSeconds();
    const diff = timestamp - now;
    if (diff <= 0) return null;
    if (diff < 60) return { label: "<1dk", urgent: true, past: false };
    const hours = Math.floor(diff / 3600);
    const minutes = Math.floor((diff % 3600) / 60);
    const label = hours > 0 ? `${hours}s ${minutes}dk` : `${minutes}dk`;
    return { label, urgent: diff < 3600, past: false };
  };

  const getFlightDepartureTimestamp = (flight: Flight) => {
    const rawTime = String(flight.dep_estimated || flight.dep_time || "").trim();
    const minutes = parseDepartureMinutes(rawTime);
    if (minutes === null) {
      return flight.dep_estimated_ts || flight.dep_time_ts;
    }
    return buildIstanbulTimestamp(minutes, flight.dep_day_offset);
  };

  const isCounterClosed = (terminal: (typeof TERMINALS)[number], timestamp: number) => {
    if (timestamp <= 0) return false;
    const now = getIstanbulNowSeconds();
    return (timestamp - now) / 60 <= COUNTER_CLOSE_MINUTES[terminal];
  };

  const syncSheetsData = async () => {
    const [flightPlanEntries, { data: allServices }, { data: wheelchairRows }] = await Promise.all([
      fetchFlightPlanEntriesMerged(),
      supabase.from("wheelchair_services").select("*").order("created_at", { ascending: false }),
      supabase.from("wheelchairs").select("terminal, status"),
    ]);
    const departures = buildDeparturesPayload(flightPlanEntries, allServices || []);
    const specialServices = buildSpecialServicesPayload(buildFlightLookup(flightPlanEntries), allServices || []);
    const inventorySummary = buildInventorySummaryPayload(wheelchairRows || []);
    await triggerGoogleSheetsSync({ departures, specialServices, inventorySummary, handovers: [] });
  };

  // ── Data fetching ──

  const fetchFlights = async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      // Snapshot + canlı CSV birleşik veri (süreklilik)
      const mergeResult = await fetchFlightPlanEntriesMergedWithWindow();
      const flightPlanEntries = mergeResult.entries;
      const departureTimestamps = buildDepartureTimestamps(
        flightPlanEntries,
        mergeResult.liveWindowStartMinutes,
        mergeResult.liveWindowEndMinutes,
        mergeResult.crossesMidnight,
      );
      const mappedFlights = flightPlanEntries
        .map((entry, index) => {
          const flightCode = normalizeFlightCode(entry.departureCode || "");
          const depDayOffset = getDepartureDayOffset(
            entry.departureTime || "",
            mergeResult.liveWindowStartMinutes,
            mergeResult.liveWindowEndMinutes,
            mergeResult.crossesMidnight,
          );
          return {
            airline_iata: extractAirlineCode(flightCode),
            flight_iata: flightCode,
            flight_number: extractFlightNumber(flightCode),
            list_order: index,
            dep_day_offset: depDayOffset,
            dep_iata: "AYT",
            dep_terminal: getTerminalFromDestination(entry.departureIATA),
            dep_gate: entry.parkPosition || null,
            dep_time: entry.departureTime || "",
            dep_time_ts: departureTimestamps[index] || 0,
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
        .filter((flight) => Boolean(flight.flight_iata));
      setFlights(mappedFlights);
      setLastUpdated(new Date());
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
    if (data) setServices(data as WheelchairService[]);
  };

  const fetchWheelchairs = async () => {
    const { data } = await supabase
      .from("wheelchairs")
      .select("id, wheelchair_id, status, terminal");
    if (data) setWheelchairs(data as WheelchairInventory[]);
  };

  // ── Pre-flight alerts ──

  useEffect(() => {
    if (flights.length === 0 || services.length === 0) return;
    const nowSeconds = getIstanbulNowSeconds();
    const serviceKeys = services.map((service) => ({
      service,
      keys: new Set<string>(getFlightCodeMatchKeys(service.flight_iata || "")),
    }));

    flights.forEach((flight) => {
      const depTime = getFlightDepartureTimestamp(flight);
      const terminal = resolveFlightTerminal(flight);
      if (!terminal) return;
      const thresholdMinutes = COUNTER_CLOSE_MINUTES[terminal];
      const remainingMinutes = (depTime - nowSeconds) / 60;
      const alertKey = `${flight.flight_iata}|${depTime}|${thresholdMinutes}`;
      if (sentPreFlightAlertsRef.current.has(alertKey)) return;
      if (!(remainingMinutes <= thresholdMinutes && remainingMinutes > thresholdMinutes - PRE_FLIGHT_ALERT_WINDOW_MINUTES)) return;

      const flightKeys = new Set<string>([
        ...getFlightCodeMatchKeys(flight.flight_iata || ""),
        ...getFlightCodeMatchKeys(`${flight.airline_iata || ""}${flight.flight_number || ""}`),
        ...getFlightCodeMatchKeys(flight.flight_number || ""),
      ]);

      const relatedServices = serviceKeys
        .filter(({ service, keys }) => service.terminal === terminal && Array.from(keys).some((key) => flightKeys.has(key)))
        .map(({ service }) => service);

      if (relatedServices.length === 0) return;

      const passengerTypeCount = relatedServices.reduce<Record<string, number>>((acc, s) => {
        acc[s.passenger_type] = (acc[s.passenger_type] || 0) + 1;
        return acc;
      }, {});
      const passengerSummary = Object.entries(passengerTypeCount).map(([type, count]) => `${type}:${count}`).join(" • ");
      const visibleNotes = Array.from(new Set(
        relatedServices
          .map((service) => getVisibleServiceNotes(service.notes))
          .filter(Boolean),
      ));
      const noteSummary = visibleNotes.length > 0
        ? ` • Not: ${visibleNotes.slice(0, 2).join(" | ")}${visibleNotes.length > 2 ? " ..." : ""}`
        : "";
      const gate = getDisplayGate(flight);
      const gateInfo = gate !== "-" ? ` • Gate: ${gate}` : "";
      const detail = `Toplam WCH: ${relatedServices.length} • ${passengerSummary}${noteSummary}${gateInfo}`;

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
        dep_gate: gate,
      }).catch((pushError) => {
        sentPreFlightAlertsRef.current.delete(alertKey);
        console.error("Pre-flight service summary push failed:", pushError);
      });
    });
  }, [currentUser, flights, services]);

  // ── Mount / subscriptions ──

  useEffect(() => {
    const user = localStorage.getItem("userName");
    if (user) setCurrentUser(user);

    fetchFlights();
    fetchServices();
    fetchWheelchairs();

    const handleServiceRealtime = (payload: RealtimePostgresChangesPayload<WheelchairService>) => {
      if (payload.eventType === "INSERT") {
        const next = payload.new as WheelchairService;
        setServices((prev) => {
          if (prev.some((s) => s.id === next.id)) return prev;
          return [next, ...prev].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        });
        return;
      }
      if (payload.eventType === "UPDATE") {
        const updated = payload.new as WheelchairService;
        setServices((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
        return;
      }
      if (payload.eventType === "DELETE") {
        const deleted = payload.old as WheelchairService;
        setServices((prev) => prev.filter((s) => s.id !== deleted.id));
      }
    };

    const servicesChannel = supabase
      .channel("wheelchair_services_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "wheelchair_services" }, handleServiceRealtime)
      .subscribe();

    const wheelchairsChannel = supabase
      .channel("wheelchairs_services_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "wheelchairs" }, () => fetchWheelchairs())
      .subscribe();

    const interval = setInterval(() => fetchFlights(true), 60000);
    return () => {
      clearInterval(interval);
      supabase.removeChannel(servicesChannel);
      supabase.removeChannel(wheelchairsChannel);
    };
  }, []);

  // ── Handlers ──

  const handleAddService = async (
    flight: Flight,
    wheelchairId: string,
    passengerType: string,
    notes: string,
    assignedStaff: string,
  ) => {
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
      if (!isAssignedStaffSchemaCacheError(error)) throw error;
      const fallbackNotes = buildServiceNotesWithAssignedStaff(cleanNotes, assignedStaff);
      const { error: fallbackError } = await supabase.from("wheelchair_services").insert({
        flight_iata: flight.flight_iata,
        wheelchair_id: wheelchairId,
        passenger_type: passengerType,
        notes: fallbackNotes,
        terminal: activeTab,
        created_by: currentUser,
      });
      if (fallbackError) throw fallbackError;
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
      dep_gate: getDisplayGate(flight),
      notification_kind: "service-created",
    }).catch((e) => console.error("Push notification failed:", e));

    toast.success(`${flight.flight_iata} için hizmet kaydedildi`, {
      description: `${passengerType} • ${wheelchairId} • ${assignedStaff}`,
    });

    fetchServices();
    void fetchFlights(true);
    setShowServiceDialog(false);

    void syncSheetsData().catch((syncErr) => {
      console.error("Post-add Sheets sync failed:", syncErr);
    });
  };

  const handleUpdateService = async (
    flight: Flight,
    wheelchairId: string,
    passengerType: string,
    notes: string,
    assignedStaff: string,
  ) => {
    if (!editingService) {
      return handleAddService(flight, wheelchairId, passengerType, notes, assignedStaff);
    }

    const cleanNotes = notes.trim();
    const updatePayload = {
      assigned_staff: assignedStaff,
      wheelchair_id: wheelchairId,
      passenger_type: passengerType,
      notes: cleanNotes,
      terminal: activeTab,
      flight_iata: flight.flight_iata,
    };

    const { error } = await supabase.from("wheelchair_services").update(updatePayload).eq("id", editingService.id);

    if (error) {
      if (!isAssignedStaffSchemaCacheError(error)) throw error;
      const fallbackNotes = buildServiceNotesWithAssignedStaff(cleanNotes, assignedStaff);
      const { error: fallbackError } = await supabase.from("wheelchair_services").update({
        wheelchair_id: wheelchairId,
        passenger_type: passengerType,
        notes: fallbackNotes,
        terminal: activeTab,
        flight_iata: flight.flight_iata,
      }).eq("id", editingService.id);
      if (fallbackError) throw fallbackError;
    }

    await supabase.from("action_logs").insert({
      wheelchair_id: wheelchairId,
      action: "Hizmet Güncellendi",
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
      dep_gate: getDisplayGate(flight),
      notification_kind: "service-updated",
    }).catch((pushError) => console.error("Update push notification failed:", pushError));

    toast.success(`${flight.flight_iata} hizmeti güncellendi`, {
      description: `${passengerType} • ${wheelchairId} • ${assignedStaff}`,
    });

    fetchServices();
    void fetchFlights(true);
    setEditingService(null);
    setSelectedFlight(null);
    setShowServiceDialog(false);

    void syncSheetsData().catch((syncErr) => {
      console.error("Post-update Sheets sync failed:", syncErr);
    });
  };

  const handleDeleteService = async () => {
    if (!deleteTarget) return;
    const { id, flightIata } = deleteTarget;
    setDeleteTarget(null);

    try {
      const { error } = await supabase.from("wheelchair_services").delete().eq("id", id);
      if (error) throw error;

      const service = services.find((s) => s.id === id);
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
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Bilinmeyen hata";
      toast.error("Hizmet silinemedi: " + message);
    }
  };

  const handleCompleteService = async (service: WheelchairService) => {
    if (isServiceCompleted(service)) return;

    const nextNotes = markServiceAsCompleted(service.notes);
    try {
      const { error } = await supabase
        .from("wheelchair_services")
        .update({ notes: nextNotes })
        .eq("id", service.id);

      if (error) throw error;

      await supabase.from("action_logs").insert({
        wheelchair_id: service.wheelchair_id,
        action: "Hizmet Tamamlandı",
        details: `${service.flight_iata} • ${service.passenger_type}`,
        performed_by: currentUser,
      });

      setServices((prev) => prev.map((item) => (item.id === service.id ? { ...item, notes: nextNotes } : item)));
      toast.success(`${service.flight_iata} hizmeti tamamlandı olarak işaretlendi`);

      void syncSheetsData().catch((syncErr) => {
        console.error("Post-complete Sheets sync failed:", syncErr);
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Bilinmeyen hata";
      toast.error("Hizmet tamamlandı olarak işaretlenemedi: " + message);
    }
  };

  // ── Derived state ──

  const flightLookup = useMemo(() => {
    const lookup = new Map<string, Flight>();
    flights.forEach((flight) => {
      const keys = new Set<string>([
        ...getFlightCodeMatchKeys(flight.flight_iata || ""),
        ...getFlightCodeMatchKeys(`${flight.airline_iata || ""}${flight.flight_number || ""}`),
        ...getFlightCodeMatchKeys(flight.flight_number || ""),
      ]);
      keys.forEach((key) => { if (key) lookup.set(key, flight); });
    });
    return lookup;
  }, [flights]);

  const terminalServices = useMemo(
    () =>
      services.filter((service) => {
        if (service.terminal !== activeTab) return false;
        if (isServiceCompleted(service)) return false;
        return getFlightCodeMatchKeys(service.flight_iata || "").some((key) => flightLookup.has(key));
      }),
    [services, activeTab, flightLookup],
  );

  const visibleTerminalServices = terminalServices;

  const terminalWheelchairs = useMemo(
    () => wheelchairs.filter((w) => matchesWheelchairInventoryTerminal(activeTab, w.terminal)),
    [wheelchairs, activeTab],
  );

  const availableWheelchairCount = terminalWheelchairs.filter((w) => w.status === "available").length;
  const missingWheelchairCount = terminalWheelchairs.filter((w) => w.status === "missing").length;

  const filteredFlights = useMemo(
    () => flights.filter((f) => resolveFlightTerminal(f) === activeTab),
    [flights, activeTab],
  );

  // Service count per flight (for badges on flight cards)
  const flightServiceCount = useMemo(() => {
    const count = new Map<string, number>();
    visibleTerminalServices.forEach((service) => {
      getFlightCodeMatchKeys(service.flight_iata || "").forEach((key) => {
        count.set(key, (count.get(key) || 0) + 1);
      });
    });
    return count;
  }, [visibleTerminalServices]);

  const getServiceCountForFlight = (flight: Flight) => {
    const keys = getFlightCodeMatchKeys(flight.flight_iata || "");
    return keys.reduce((acc, key) => Math.max(acc, flightServiceCount.get(key) || 0), 0);
  };

  const servicedFlightsCount = useMemo(
    () => filteredFlights.filter((flight) => getServiceCountForFlight(flight) > 0).length,
    [filteredFlights, flightServiceCount],
  );

  const q = searchQuery.trim().toLocaleLowerCase("tr");

  const filteredServices = useMemo(
    () =>
      visibleTerminalServices.filter((service) => {
        if (!q) return true;
        const assignedStaff = extractAssignedStaffFromService(service);
        const visibleNotes = getVisibleServiceNotes(service.notes);
        return [service.flight_iata, service.wheelchair_id, service.passenger_type, visibleNotes, service.created_by]
          .concat(assignedStaff)
          .join(" ")
          .toLocaleLowerCase("tr")
          .includes(q);
      }),
    [visibleTerminalServices, q],
  );

  const sortedFilteredFlights = useMemo(() => {
    const flts = filteredFlights.filter((flight) => {
      if (!q) return true;
      return [flight.flight_iata, flight.flight_number, flight.arr_iata, flight.dep_gate, flight.airline_iata]
        .join(" ")
        .toLocaleLowerCase("tr")
        .includes(q);
    });
    // Keep terminal lists in the exact merged CSV order.
    return flts.sort((a, b) => a.list_order - b.list_order);
  }, [filteredFlights, q]);

  // Tab counts
  const tabCounts = useMemo(() => {
    const counts: Record<string, { services: number; flights: number }> = {};
    TERMINALS.forEach((t) => {
      counts[t] = {
        services: services.filter((s) => s.terminal === t && !isServiceCompleted(s) && getFlightCodeMatchKeys(s.flight_iata || "").some((key) => flightLookup.has(key))).length,
        flights: flights.filter((f) => resolveFlightTerminal(f) === t).length,
      };
    });
    return counts;
  }, [services, flights, flightLookup]);

  // ── Render ──

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/60 bg-card/70 backdrop-blur-md sticky top-0 z-30">
        <div className="container flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="-ml-1" onClick={() => navigate("/")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
              <Accessibility className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h1 className="font-heading font-bold text-base leading-none">Sandalye Hizmetleri</h1>
              {lastUpdated && (
                <p className="text-[10px] text-muted-foreground mt-0.5 leading-none">
                  Güncellendi: {lastUpdated.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Canlı
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => fetchFlights()}
              disabled={refreshing}
              title="Yenile"
            >
              <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
            </Button>
          </div>
        </div>
      </header>

      <main className="container px-4 py-5 space-y-5">
        {/* Stats Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            label="Aktif Hizmet"
            value={loading ? "—" : visibleTerminalServices.length}
            icon={<Users className="w-4 h-4" />}
          />
          <StatCard
            label="Müsait Sandalye"
            value={loading ? "—" : availableWheelchairCount}
            color="text-primary"
            icon={<Accessibility className="w-4 h-4" />}
          />
          <StatCard
            label="Eksik Sandalye"
            value={loading ? "—" : missingWheelchairCount}
            color={missingWheelchairCount > 0 ? "text-destructive" : undefined}
            icon={<AlertTriangle className="w-4 h-4" />}
          />
          <StatCard
            label="Hizmetli Uçuş"
            value={loading ? "—" : servicedFlightsCount}
            color={servicedFlightsCount > 0 ? "text-sky-700" : undefined}
            icon={<Activity className="w-4 h-4" />}
          />
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Uçuş, sandalye, yolcu tipi veya personel ara..."
            className="pl-9 pr-9 bg-card"
          />
          {searchQuery && (
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setSearchQuery("")}
              aria-label="Aramayı temizle"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-secondary rounded-xl border border-border/40 h-auto p-1 gap-1 w-full sm:w-auto">
            {TERMINALS.map((t) => (
              <TabsTrigger
                key={t}
                value={t}
                className="font-heading rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow flex-1 sm:flex-none gap-2"
              >
                {TERMINAL_LABELS[t]}
                {tabCounts[t] && (
                  <span className={cn(
                    "text-[10px] font-mono rounded-full px-1.5 py-0.5 leading-none",
                    activeTab === t
                      ? "bg-primary-foreground/20 text-primary-foreground"
                      : "bg-foreground/10 text-foreground",
                  )}>
                    {tabCounts[t].services}/{tabCounts[t].flights}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          {TERMINALS.map((terminal) => (
            <TabsContent key={terminal} value={terminal} className="mt-5">
              <div className="grid gap-6 lg:grid-cols-[1fr_1.8fr]">

                {/* ── Left: Active Services ── */}
                <section>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <h2 className="font-heading font-semibold text-sm uppercase tracking-wide text-muted-foreground">Aktif Hizmetler</h2>
                      {visibleTerminalServices.length > 0 && (
                        <Badge variant="secondary" className="text-xs h-5 px-1.5">{visibleTerminalServices.length}</Badge>
                      )}
                    </div>
                  </div>

                  {loading ? (
                    <div className="space-y-2">
                      {[1, 2, 3].map((i) => <ServiceCardSkeleton key={i} />)}
                    </div>
                  ) : filteredServices.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border py-12 text-center text-muted-foreground">
                      <Users className="w-8 h-8 mx-auto mb-2 opacity-20" />
                      <p className="text-sm">
                        {visibleTerminalServices.length === 0
                          ? "Bu terminalde kayıtlı hizmet yok"
                          : "Aramaya uygun hizmet bulunamadı"}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {filteredServices.map((service) => {
                        const relatedFlight = getFlightCodeMatchKeys(service.flight_iata || "")
                          .map((key) => flightLookup.get(key))
                          .find(Boolean);
                        const assignedStaff = extractAssignedStaffFromService(service);
                        const visibleNotes = getVisibleServiceNotes(removeCompletedTag(service.notes));
                        const typeStyle = PASSENGER_TYPE_STYLES[service.passenger_type] || PASSENGER_TYPE_STYLES.STEP;
                        const isExpanded = expandedServices.has(service.id);
                        const createdTime = new Date(service.created_at).toLocaleTimeString("tr-TR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        });

                        return (
                          <Card
                            key={service.id}
                            className="border-border/60 overflow-hidden transition-shadow hover:shadow-sm"
                          >
                            {/* Colored left accent based on passenger type */}
                            <div className={cn(
                              "h-0.5",
                              service.passenger_type === "STEP" && "bg-blue-400",
                              service.passenger_type === "RAMP" && "bg-green-400",
                              service.passenger_type === "CABIN" && "bg-purple-400",
                            )} />
                            <CardContent className="py-3 px-4">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex items-start gap-3 flex-1 min-w-0">
                                  <div className="flex-1 min-w-0">
                                    {/* Row 1: flight + type badge */}
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-heading font-bold text-sm">{service.flight_iata}</span>
                                      <Badge className={cn("text-[10px] border px-1.5 py-0 h-4 font-medium", typeStyle.badge)}>
                                        {typeStyle.label}
                                      </Badge>
                                    </div>
                                    {/* Row 2: wheelchair + staff */}
                                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                                      <span className="flex items-center gap-1">
                                        <Accessibility className="w-3 h-3" />
                                        {service.wheelchair_id}
                                      </span>
                                      <span className="text-border">·</span>
                                      <span>{assignedStaff || "Belirtilmedi"}</span>
                                      {relatedFlight && (
                                        <>
                                          <span className="text-border">·</span>
                                          <span className="flex items-center gap-1">
                                            <MapPin className="w-3 h-3" />
                                            {getDisplayGate(relatedFlight)}
                                          </span>
                                        </>
                                      )}
                                    </div>
                                    {/* Expandable: notes + created by */}
                                    {isExpanded && (
                                      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                                        {visibleNotes && (
                                          <p className="text-foreground/80 italic">"{visibleNotes}"</p>
                                        )}
                                        <p>Kaydeden: {service.created_by || "Personel"}</p>
                                      </div>
                                    )}
                                  </div>
                                </div>

                                <div className="flex items-center gap-1 flex-shrink-0">
                                  <span className="text-[10px] font-mono text-muted-foreground">{createdTime}</span>
                                  {(visibleNotes || service.created_by) && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="w-6 h-6 text-muted-foreground hover:text-foreground"
                                      onClick={() =>
                                        setExpandedServices((prev) => {
                                          const next = new Set(prev);
                                          if (next.has(service.id)) next.delete(service.id);
                                          else next.add(service.id);
                                          return next;
                                        })
                                      }
                                    >
                                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                    </Button>
                                  )}
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="w-6 h-6 text-muted-foreground hover:text-emerald-600 hover:bg-emerald-50"
                                    onClick={() => void handleCompleteService(service)}
                                    title="Hizmet tamamlandı"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="w-6 h-6 text-muted-foreground hover:text-foreground"
                                    onClick={() => {
                                      const relatedFlight = getFlightCodeMatchKeys(service.flight_iata || "")
                                        .map((key) => flightLookup.get(key))
                                        .find(Boolean);
                                      if (!relatedFlight) {
                                        toast.error("Bu hizmet için aktif uçuş bulunamadı");
                                        return;
                                      }
                                      setSelectedFlight(relatedFlight);
                                      setEditingService({
                                        id: service.id,
                                        wheelchair_id: service.wheelchair_id,
                                        passenger_type: service.passenger_type,
                                        notes: visibleNotes,
                                        assigned_staff: assignedStaff,
                                        flight_iata: service.flight_iata,
                                      });
                                      setShowServiceDialog(true);
                                    }}
                                    title="Düzenle"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="w-6 h-6 text-muted-foreground hover:text-red-600 hover:bg-red-50"
                                    onClick={() => setDeleteTarget({ id: service.id, flightIata: service.flight_iata })}
                                    title="Sil"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </section>

                {/* ── Right: Flights ── */}
                <section>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <h2 className="font-heading font-semibold text-sm uppercase tracking-wide text-muted-foreground">Uçuş Listesi</h2>
                      {filteredFlights.length > 0 && (
                        <Badge variant="secondary" className="text-xs h-5 px-1.5">{filteredFlights.length}</Badge>
                      )}
                    </div>
                  </div>

                  {loading ? (
                    <div className="space-y-3">
                      {[1, 2, 3, 4].map((i) => <FlightCardSkeleton key={i} />)}
                    </div>
                  ) : sortedFilteredFlights.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border py-16 text-center text-muted-foreground">
                      <Plane className="w-10 h-10 mx-auto mb-3 opacity-20" />
                      <p className="text-sm">
                        {filteredFlights.length === 0
                          ? "Bu terminalde aktif uçuş yok"
                          : "Aramaya uygun uçuş bulunamadı"}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {sortedFilteredFlights.map((flight) => {
                        const serviceCount = getServiceCountForFlight(flight);
                        const gate = getDisplayGate(flight);

                        return (
                          <Card
                            key={flight.flight_iata}
                            className={cn(
                              "overflow-hidden transition-all duration-200",
                              "border-border/60 hover:border-primary/40 hover:shadow-sm",
                            )}
                          >
                            <CardContent className="p-4">
                              <div className="flex items-start justify-between gap-3">
                                {/* Left: Airline icon + info */}
                                <div className="flex items-start gap-3 flex-1 min-w-0">
                                  <div className={cn(
                                    "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
                                    "bg-primary/10",
                                  )}>
                                    <Plane className={cn(
                                      "w-5 h-5",
                                      "text-primary",
                                    )} />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-heading font-bold text-base">
                                        {flight.airline_iata} {flight.flight_number}
                                      </span>
                                      {serviceCount > 0 && (
                                        <Badge className="text-[10px] bg-primary/15 text-primary border-primary/20 h-4 px-1.5">
                                          {serviceCount} hizmet
                                        </Badge>
                                      )}
                                    </div>
                                    <p className="text-xs mt-0.5 text-muted-foreground">
                                      {flight.dep_iata} → {flight.arr_iata}
                                    </p>
                                  </div>
                                </div>

                                {/* Right: Time */}
                                <div className="text-right flex-shrink-0">
                                  <p className="font-mono font-bold text-base text-foreground">
                                    {formatFlightTime(flight)}
                                  </p>
                                </div>
                              </div>

                              <Separator className="my-3 opacity-50" />

                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                  <span className="flex items-center gap-1">
                                    <MapPin className="w-3 h-3" />
                                    Gate {gate}
                                  </span>
                                  {flight.delayed && flight.delayed > 0 && (
                                    <span className="flex items-center gap-1 text-orange-600 font-medium">
                                      <AlertTriangle className="w-3 h-3" />
                                      +{flight.delayed}dk gecikme
                                    </span>
                                  )}
                                  {flightNotes[flight.flight_iata] && (
                                    <span className="flex items-center gap-1 text-amber-600 font-medium">
                                      <MessageSquare className="w-3 h-3" />
                                      {flightNotes[flight.flight_iata].length > 20
                                        ? flightNotes[flight.flight_iata].slice(0, 20) + "…"
                                        : flightNotes[flight.flight_iata]}
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-1.5">
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    title="Uçuşa not ekle"
                                    className={cn(
                                      "h-8 w-8 rounded-lg relative",
                                      flightNotes[flight.flight_iata]
                                        ? "border-amber-400 text-amber-600 hover:bg-amber-50"
                                        : "text-muted-foreground",
                                    )}
                                    onClick={() => setNoteDialog({ flightIata: flight.flight_iata, value: flightNotes[flight.flight_iata] || "" })}
                                  >
                                    <MessageSquare className="w-3.5 h-3.5" />
                                    {flightNotes[flight.flight_iata] && (
                                      <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-amber-500" />
                                    )}
                                  </Button>
                                  <Button
                                  size="sm"
                                  onClick={() => {
                                    setSelectedFlight(flight);
                                    setShowServiceDialog(true);
                                  }}
                                  className="gap-1.5 text-xs h-8 rounded-lg"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                  Hizmet Ekle
                                </Button>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </section>

              </div>
            </TabsContent>
          ))}
        </Tabs>
      </main>

      {/* Flight Note Dialog */}
      <Dialog open={Boolean(noteDialog)} onOpenChange={(open) => { if (!open) setNoteDialog(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-amber-500" />
              Uçuş Notu — {noteDialog?.flightIata}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <Label className="text-sm text-muted-foreground">Operasyonel not (sadece bu cihazda saklanır)</Label>
            <Textarea
              rows={3}
              autoFocus
              placeholder="Bu uçuşa özel operasyonel not girin..."
              className="bg-secondary border-border resize-none"
              value={noteDialog?.value ?? ""}
              onChange={(e) => setNoteDialog((prev) => prev ? { ...prev, value: e.target.value } : null)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.ctrlKey && noteDialog) {
                  saveFlightNote(noteDialog.flightIata, noteDialog.value.trim());
                  setNoteDialog(null);
                }
              }}
            />
            <p className="text-[11px] text-muted-foreground">Ctrl+Enter ile kaydet</p>
          </div>
          <DialogFooter className="gap-2 flex-col sm:flex-row">
            {noteDialog && flightNotes[noteDialog.flightIata] && (
              <Button
                variant="outline"
                className="text-destructive border-destructive/30 hover:bg-destructive/5 sm:mr-auto"
                onClick={() => {
                  clearFlightNote(noteDialog.flightIata);
                  setNoteDialog(null);
                }}
              >
                Notu Sil
              </Button>
            )}
            <Button variant="outline" onClick={() => setNoteDialog(null)}>İptal</Button>
            <Button
              onClick={() => {
                if (noteDialog) {
                  if (noteDialog.value.trim()) {
                    saveFlightNote(noteDialog.flightIata, noteDialog.value.trim());
                    toast.success("Not kaydedildi");
                  } else {
                    clearFlightNote(noteDialog.flightIata);
                  }
                  setNoteDialog(null);
                }
              }}
            >
              Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Service Dialog */}
      <AddServiceDialog
        open={showServiceDialog}
        onOpenChange={(open) => {
          setShowServiceDialog(open);
          if (!open) {
            setEditingService(null);
            setSelectedFlight(null);
          }
        }}
        flight={selectedFlight}
        terminal={activeTab}
        onConfirm={editingService ? handleUpdateService : handleAddService}
        onServiceAdded={fetchServices}
        formatFlightTime={formatFlightTime}
        getDisplayGate={getDisplayGate}
        serviceToEdit={editingService}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hizmeti sil</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.flightIata}</strong> uçuşuna ait bu hizmet kaydı kalıcı olarak silinecek. Bu işlem geri alınamaz.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Vazgeç</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteService}
            >
              Evet, sil
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default WheelchairServicesPage;