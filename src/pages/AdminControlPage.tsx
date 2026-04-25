import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { getBriefings, hasCustomBriefings, resetBriefings, saveBriefings } from "@/lib/briefings";
import { fetchFlightPlanEntries, getFlightCodeMatchKeys, normalizeFlightCode, type FlightPlanEntry } from "@/lib/flight-plan";
import { fetchAirlineTerminalRules, getDefaultAirlineTerminalRules, isAirlineTerminalRulesTableMissing, readStoredAirlineTerminalRules, saveStoredAirlineTerminalRules, type AirlineTerminalRule, type AirlineTerminalRulesSource } from "@/lib/flight-rules";
import { triggerGoogleSheetsSync } from "@/lib/google-sheets-sync";
import { extractAssignedStaffFromService, getVisibleServiceNotes } from "@/lib/wheelchair-service-utils";
import {
  clearStoredSchedulePayload,
  getStoredSchedulePayload,
  hasStoredSchedulePayload,
  isValidSchedulePayload,
  parseScheduleWorkbook,
  saveSchedulePayload,
  type SchedulePayload,
} from "@/lib/work-schedule";
import { toast } from "sonner";
import { AlertTriangle, BellRing, CalendarDays, ClipboardList, Clock3, DatabaseZap, LogOut, Megaphone, Plane, RefreshCw, ShieldCheck, Trash2, Users, Wrench } from "lucide-react";

type AdminSummary = {
  totalWheelchairs: number;
  missingWheelchairs: number;
  maintenanceWheelchairs: number;
  activeShifts: number;
  activeSubscribers: number;
  onShiftSubscribers: number;
};

type ActionLog = Tables<"action_logs">;
type PushSubscriptionRow = Tables<"push_subscriptions">;
type ShiftRow = Tables<"shifts">;
type WheelchairRow = Tables<"wheelchairs">;
type ServiceRow = Tables<"wheelchair_services">;
type ServiceTrendRow = Pick<ServiceRow, "created_at" | "created_by">;
type HandoverTrendRow = Pick<ActionLog, "created_at" | "details">;

type HandoverRecord = {
  id: string;
  terminal: string;
  fromStaff: string;
  toStaff: string;
  snapshot: string;
  checklist: string;
  createdAt: string;
};

const SHIFT_PATTERN = /^(\d{2})(\d{2})-(\d{2})(\d{2})$/;
const normalizeStaffName = (value: string) => value.trim().toLocaleLowerCase("tr");
const formatPercent = (value: number) => `${value.toFixed(1)}%`;
const formatSignedPercent = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;

const getLocalDateKey = (value: string) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const parseHandoverRiskCount = (details: string) => {
  const [, snapshot = ""] = details.split(" | ");
  const missingCount = Number(snapshot.match(/🔴\s*(\d+)/)?.[1] || 0);
  const maintenanceCount = Number(snapshot.match(/🟠\s*(\d+)/)?.[1] || 0);
  return missingCount + maintenanceCount;
};

const calculateDeltaPercent = (current: number, baseline: number) => {
  if (baseline <= 0) {
    return null;
  }

  return ((current - baseline) / baseline) * 100;
};

const extractAirlineCodeFromFlightCode = (value: string) => {
  const match = normalizeFlightCode(value).match(/^[A-Z0-9]+?(?=\d|$)/);
  return match?.[0] || "";
};

const getMinuteOfDay = (date: Date) => date.getHours() * 60 + date.getMinutes();

const parseShift = (value: string) => {
  const normalized = value.trim().replace(/\s+/g, "");
  const match = normalized.match(SHIFT_PATTERN);
  if (!match) {
    return null;
  }

  const start = Number(match[1]) * 60 + Number(match[2]);
  const end = Number(match[3]) * 60 + Number(match[4]);
  return {
    start,
    end,
    overnight: end <= start,
  };
};

const isActiveForToday = (value: string, minuteNow: number) => {
  const parsed = parseShift(value);
  if (!parsed) {
    return false;
  }

  if (!parsed.overnight) {
    return minuteNow >= parsed.start && minuteNow < parsed.end;
  }

  return minuteNow >= parsed.start || minuteNow < parsed.end;
};

const isActiveFromPreviousDayOvernight = (value: string, minuteNow: number) => {
  const parsed = parseShift(value);
  if (!parsed || !parsed.overnight) {
    return false;
  }

  return minuteNow < parsed.end;
};

const AdminControlPage = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [currentUser, setCurrentUser] = useState("");
  const [summary, setSummary] = useState<AdminSummary>({
    totalWheelchairs: 0,
    missingWheelchairs: 0,
    maintenanceWheelchairs: 0,
    activeShifts: 0,
    activeSubscribers: 0,
    onShiftSubscribers: 0,
  });
  const [recentLogs, setRecentLogs] = useState<ActionLog[]>([]);
  const [serviceHistoryLogs, setServiceHistoryLogs] = useState<ServiceRow[]>([]);
  const [recentHandovers, setRecentHandovers] = useState<HandoverRecord[]>([]);
  const [wheelchairDetails, setWheelchairDetails] = useState<WheelchairRow[]>([]);
  const [shiftDetails, setShiftDetails] = useState<ShiftRow[]>([]);
  const [todayServices, setTodayServices] = useState<ServiceRow[]>([]);
  const [serviceTrendRows, setServiceTrendRows] = useState<ServiceTrendRow[]>([]);
  const [handoverTrendLogs, setHandoverTrendLogs] = useState<HandoverTrendRow[]>([]);
  const [airlineTerminalRules, setAirlineTerminalRules] = useState<AirlineTerminalRule[]>(() => getDefaultAirlineTerminalRules());
  const [airlineTerminalRulesSource, setAirlineTerminalRulesSource] = useState<AirlineTerminalRulesSource>("fallback");
  const [newRuleAirlineCode, setNewRuleAirlineCode] = useState("");
  const [newRuleTerminalCode, setNewRuleTerminalCode] = useState<"T1" | "T2">("T2");
  const [newRuleNote, setNewRuleNote] = useState("");
  const [savingRule, setSavingRule] = useState(false);
  const [updatingRuleCode, setUpdatingRuleCode] = useState<string | null>(null);
  const [deletingRuleCode, setDeletingRuleCode] = useState<string | null>(null);
  const [pushSubscriptions, setPushSubscriptions] = useState<PushSubscriptionRow[]>([]);
  const [schedulePayload, setSchedulePayload] = useState<SchedulePayload>(() => getStoredSchedulePayload());
  const [hasCustomSchedule, setHasCustomSchedule] = useState(() => hasStoredSchedulePayload());
  const [briefingDraft, setBriefingDraft] = useState(() => getBriefings().join("\n"));
  const [customBriefingsActive, setCustomBriefingsActive] = useState(() => hasCustomBriefings());
  const [deletingLogId, setDeletingLogId] = useState<string | null>(null);
  const [now, setNow] = useState(new Date());
  const [selectedLogDate, setSelectedLogDate] = useState<Date>(new Date());
  const [logSearchQuery, setLogSearchQuery] = useState("");
  const [logActionFilter, setLogActionFilter] = useState("all");
  const [serviceSearchQuery, setServiceSearchQuery] = useState("");
  const [serviceTerminalFilter, setServiceTerminalFilter] = useState("all");
  const [syncingGoogleSheets, setSyncingGoogleSheets] = useState(false);

  const currentWeekLabel = schedulePayload.weekDates.length
    ? `${schedulePayload.weekDates[0]} - ${schedulePayload.weekDates[schedulePayload.weekDates.length - 1]}`
    : "Hafta verisi yok";

  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const minuteNow = getMinuteOfDay(now);
  const todayStartIso = useMemo(
    () => new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString(),
    [now],
  );
  const trendStartIso = useMemo(
    () => new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7).toISOString(),
    [now],
  );

  const activeScheduleCount = useMemo(() => {
    const todayIndex = schedulePayload.weekDates.indexOf(todayKey);
    const previousDayKey = todayIndex > 0 ? schedulePayload.weekDates[todayIndex - 1] : null;
    if (todayIndex === -1) {
      return 0;
    }

    return schedulePayload.employees.reduce((count, employee) => {
      const todayShift = employee.shifts[todayKey] || "";
      const previousShift = previousDayKey ? employee.shifts[previousDayKey] || "" : "";
      if (isActiveForToday(todayShift, minuteNow) || (previousDayKey && isActiveFromPreviousDayOvernight(previousShift, minuteNow))) {
        return count + 1;
      }
      return count;
    }, 0);
  }, [minuteNow, schedulePayload.employees, schedulePayload.weekDates, todayKey]);

  const plannedTodayCount = useMemo(
    () => schedulePayload.employees.reduce((count, employee) => (parseShift(employee.shifts[todayKey] || "") ? count + 1 : count), 0),
    [schedulePayload.employees, todayKey],
  );

  const activeShiftRows = useMemo(() => shiftDetails.filter((item) => !item.ended_at), [shiftDetails]);
  const missingWheelchairs = useMemo(() => wheelchairDetails.filter((item) => item.status === "missing"), [wheelchairDetails]);
  const maintenanceWheelchairs = useMemo(() => wheelchairDetails.filter((item) => item.status === "maintenance"), [wheelchairDetails]);
  const terminalServiceSummary = useMemo(() => {
    const summaryMap = new Map<string, number>();
    for (const service of todayServices) {
      summaryMap.set(service.terminal, (summaryMap.get(service.terminal) || 0) + 1);
    }
    return Array.from(summaryMap.entries()).sort((a, b) => b[1] - a[1]);
  }, [todayServices]);
  const activeShiftStaffNames = useMemo(
    () => new Set(activeShiftRows.map((item) => normalizeStaffName(item.staff_name))),
    [activeShiftRows],
  );
  const activeScheduleStaffNames = useMemo(() => {
    const todayIndex = schedulePayload.weekDates.indexOf(todayKey);
    const previousDayKey = todayIndex > 0 ? schedulePayload.weekDates[todayIndex - 1] : null;

    if (todayIndex === -1) {
      return new Set<string>();
    }

    return new Set(
      schedulePayload.employees
        .filter((employee) => {
          const todayShift = employee.shifts[todayKey] || "";
          const previousShift = previousDayKey ? employee.shifts[previousDayKey] || "" : "";

          return Boolean(
            isActiveForToday(todayShift, minuteNow)
            || (previousDayKey && isActiveFromPreviousDayOvernight(previousShift, minuteNow)),
          );
        })
        .map((employee) => normalizeStaffName(employee.name)),
    );
  }, [minuteNow, schedulePayload.employees, schedulePayload.weekDates, todayKey]);
  const validatedActiveStaffNames = useMemo(
    () => new Set(Array.from(activeShiftStaffNames).filter((name) => activeScheduleStaffNames.has(name))),
    [activeShiftStaffNames, activeScheduleStaffNames],
  );
  const shiftPerformance = useMemo(() => {
    const performanceMap = new Map<string, {
      staffName: string;
      assignedCount: number;
      createdCount: number;
      terminals: Set<string>;
      onShift: boolean;
    }>();

    for (const service of todayServices) {
      const assignedStaff = extractAssignedStaffFromService(service) || service.created_by || "Belirtilmedi";
      const assignedKey = normalizeStaffName(assignedStaff);
      const createdKey = normalizeStaffName(service.created_by || "Belirtilmedi");

      if (!performanceMap.has(assignedKey)) {
        performanceMap.set(assignedKey, {
          staffName: assignedStaff,
          assignedCount: 0,
          createdCount: 0,
          terminals: new Set<string>(),
          onShift: validatedActiveStaffNames.has(assignedKey),
        });
      }

      const assignedEntry = performanceMap.get(assignedKey)!;
      assignedEntry.assignedCount += 1;
      assignedEntry.terminals.add(service.terminal);
      assignedEntry.onShift = validatedActiveStaffNames.has(assignedKey);

      if (!performanceMap.has(createdKey)) {
        performanceMap.set(createdKey, {
          staffName: service.created_by || "Belirtilmedi",
          assignedCount: 0,
          createdCount: 0,
          terminals: new Set<string>(),
          onShift: validatedActiveStaffNames.has(createdKey),
        });
      }

      const createdEntry = performanceMap.get(createdKey)!;
      createdEntry.createdCount += 1;
      createdEntry.terminals.add(service.terminal);
      createdEntry.onShift = validatedActiveStaffNames.has(createdKey);
    }

    return Array.from(performanceMap.values())
      .sort((left, right) => {
        const leftScore = left.assignedCount + left.createdCount;
        const rightScore = right.assignedCount + right.createdCount;
        return rightScore - leftScore;
      });
  }, [todayServices, validatedActiveStaffNames]);
  const createdBySummary = useMemo(() => {
    const summaryMap = new Map<string, {
      staffName: string;
      createdCount: number;
      terminals: Set<string>;
      lastCreatedAt: string;
    }>();

    for (const service of todayServices) {
      const staffName = service.created_by || "Belirtilmedi";
      const key = normalizeStaffName(staffName);

      if (!summaryMap.has(key)) {
        summaryMap.set(key, {
          staffName,
          createdCount: 0,
          terminals: new Set<string>(),
          lastCreatedAt: service.created_at,
        });
      }

      const item = summaryMap.get(key)!;
      item.createdCount += 1;
      item.terminals.add(service.terminal);

      if (new Date(service.created_at).getTime() > new Date(item.lastCreatedAt).getTime()) {
        item.lastCreatedAt = service.created_at;
      }
    }

    return Array.from(summaryMap.values())
      .sort((left, right) => right.createdCount - left.createdCount);
  }, [todayServices]);
  const dayEndMetrics = useMemo(() => {
    const dailyServiceCounts = new Map<string, number>();
    for (const row of serviceTrendRows) {
      const key = getLocalDateKey(row.created_at);
      dailyServiceCounts.set(key, (dailyServiceCounts.get(key) || 0) + 1);
    }

    const previousDayServiceCounts = Array.from(dailyServiceCounts.entries())
      .filter(([key]) => key !== todayKey)
      .map(([, count]) => count);
    const serviceBaseline = previousDayServiceCounts.length
      ? previousDayServiceCounts.reduce((sum, count) => sum + count, 0) / previousDayServiceCounts.length
      : 0;
    const serviceDelta = calculateDeltaPercent(todayServices.length, serviceBaseline);

    const latestRiskByDay = new Map<string, { timestamp: number; riskCount: number }>();
    for (const log of handoverTrendLogs) {
      const key = getLocalDateKey(log.created_at);
      const timestamp = new Date(log.created_at).getTime();
      const riskCount = parseHandoverRiskCount(log.details || "");
      const existing = latestRiskByDay.get(key);

      if (!existing || timestamp > existing.timestamp) {
        latestRiskByDay.set(key, { timestamp, riskCount });
      }
    }

    const previousRiskRatios = Array.from(latestRiskByDay.entries())
      .filter(([key]) => key !== todayKey)
      .map(([, item]) => (summary.totalWheelchairs > 0 ? (item.riskCount / summary.totalWheelchairs) * 100 : 0));
    const riskBaseline = previousRiskRatios.length
      ? previousRiskRatios.reduce((sum, ratio) => sum + ratio, 0) / previousRiskRatios.length
      : 0;

    const todayRiskCount = missingWheelchairs.length + maintenanceWheelchairs.length;
    const todayRiskRatio = summary.totalWheelchairs > 0 ? (todayRiskCount / summary.totalWheelchairs) * 100 : 0;
    const riskDelta = calculateDeltaPercent(todayRiskRatio, riskBaseline);

    const openersToday = new Set(
      todayServices
        .map((service) => normalizeStaffName(service.created_by || ""))
        .filter(Boolean),
    ).size;
    const activeStaffCount = validatedActiveStaffNames.size;
    const openerRate = activeStaffCount > 0 ? (openersToday / activeStaffCount) * 100 : 0;

    return [
      {
        title: "Bugunku Hizmet Degisimi",
        value: serviceDelta === null ? "Referans yok" : formatSignedPercent(serviceDelta),
        detail: `Bugun: ${todayServices.length} kayit • Son gun ort: ${serviceBaseline.toFixed(1)}`,
        tone: serviceDelta !== null && serviceDelta >= 0 ? "text-emerald-400" : "text-red-400",
      },
      {
        title: "Eksik + Bakim Risk Degisimi",
        value: riskDelta === null ? formatPercent(todayRiskRatio) : `${formatPercent(todayRiskRatio)} (${formatSignedPercent(riskDelta)})`,
        detail: `Bugun risk: ${todayRiskCount}/${summary.totalWheelchairs || 0} sandalye`,
        tone: riskDelta !== null && riskDelta <= 0 ? "text-emerald-400" : "text-amber-300",
      },
      {
        title: "Personel Hizmet Acma Orani",
        value: formatPercent(openerRate),
        detail: `Hizmet acan: ${openersToday} • Aktif personel: ${activeStaffCount}`,
        tone: "text-cyan-300",
      },
    ];
  }, [handoverTrendLogs, maintenanceWheelchairs.length, missingWheelchairs.length, serviceTrendRows, summary.totalWheelchairs, todayKey, todayServices, validatedActiveStaffNames.size]);

  const operationalAlerts = useMemo(() => {
    const alerts: Array<{ id: string; level: "critical" | "warning" | "info"; title: string; detail: string }> = [];
    const currentHour = now.getHours();

    if (activeShiftRows.length === 0) {
      alerts.push({
        id: "no-active-shift",
        level: "critical",
        title: "Aktif vardiya yok",
        detail: "Sahada aktif personel gorunmuyor. Vardiya baslatma durumunu kontrol edin.",
      });
    }

    if (missingWheelchairs.length > 0) {
      alerts.push({
        id: "missing-wheelchairs",
        level: "critical",
        title: `Eksik sandalye: ${missingWheelchairs.length}`,
        detail: "Eksik durumundaki kayitlar operasyonu dogrudan etkileyebilir.",
      });
    }

    if (maintenanceWheelchairs.length >= 3) {
      alerts.push({
        id: "maintenance-high",
        level: "warning",
        title: `Bakim kuyrugu yuksek: ${maintenanceWheelchairs.length}`,
        detail: "Bakim bekleyen sandalye sayisi kritik esige yaklasti.",
      });
    }

    if (summary.activeShifts > 0 && summary.onShiftSubscribers === 0) {
      alerts.push({
        id: "no-notification-subscribers",
        level: "warning",
        title: "Vardiyada bildirim alan personel yok",
        detail: "Aktif vardiyada push abonesi gorunmuyor, bildirimler iletilemeyebilir.",
      });
    }

    if (summary.activeShifts > 0 && todayServices.length === 0 && currentHour >= 9) {
      alerts.push({
        id: "no-services-today",
        level: "warning",
        title: "Bugun hizmet kaydi acilmamis",
        detail: "Vardiya aktif olmasina ragmen gunluk hizmet kaydi bulunmuyor.",
      });
    }

    if (airlineTerminalRulesSource !== "database") {
      alerts.push({
        id: "rules-not-database",
        level: "info",
        title: "Firma-terminal kurallari veritabanindan okunmuyor",
        detail: "Kurallar su an yerel/fallback kaynaktan geliyor; canli tablolari kontrol edin.",
      });
    }

    if (alerts.length === 0) {
      alerts.push({
        id: "all-good",
        level: "info",
        title: "Kritik operasyon uyarisi yok",
        detail: "Mevcut metriklerde acil bir aksiyon ihtiyaci gorunmuyor.",
      });
    }

    return alerts;
  }, [activeShiftRows.length, airlineTerminalRulesSource, maintenanceWheelchairs.length, missingWheelchairs.length, now, summary.activeShifts, summary.onShiftSubscribers, todayServices.length]);

  const logActionOptions = useMemo(
    () => Array.from(new Set(recentLogs.map((log) => log.action))).sort((left, right) => left.localeCompare(right, "tr")),
    [recentLogs],
  );

  const filteredRecentLogs = useMemo(() => {
    const query = logSearchQuery.trim().toLocaleLowerCase("tr");
    return recentLogs.filter((log) => {
      if (logActionFilter !== "all" && log.action !== logActionFilter) {
        return false;
      }

      if (!query) {
        return true;
      }

      return [log.action, log.wheelchair_id, log.details, log.performed_by]
        .join(" ")
        .toLocaleLowerCase("tr")
        .includes(query);
    });
  }, [logActionFilter, logSearchQuery, recentLogs]);

  const filteredServiceHistoryLogs = useMemo(() => {
    const query = serviceSearchQuery.trim().toLocaleLowerCase("tr");
    return serviceHistoryLogs.filter((service) => {
      if (serviceTerminalFilter !== "all" && service.terminal !== serviceTerminalFilter) {
        return false;
      }

      if (!query) {
        return true;
      }

      const assignedStaff = extractAssignedStaffFromService(service) || "";

      return [service.flight_iata, service.wheelchair_id, service.passenger_type, service.terminal, assignedStaff, service.created_by]
        .join(" ")
        .toLocaleLowerCase("tr")
        .includes(query);
    });
  }, [serviceHistoryLogs, serviceSearchQuery, serviceTerminalFilter]);

  const csvEscape = (value: unknown) => {
    const raw = String(value ?? "");
    return `"${raw.replace(/"/g, '""')}"`;
  };

  const downloadCsv = (filename: string, headers: string[], rows: Array<Array<unknown>>) => {
    const content = [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);

    link.href = url;
    link.download = filename;
    link.click();

    URL.revokeObjectURL(url);
  };

  const handleExportRecentLogsCsv = () => {
    downloadCsv(
      `admin-logs-${selectedLogDate.toISOString().slice(0, 10)}.csv`,
      ["islem", "sandalye", "detay", "personel", "created_at"],
      filteredRecentLogs.map((log) => [log.action, log.wheelchair_id, log.details, log.performed_by || "", log.created_at]),
    );
  };

  const handleExportServiceHistoryCsv = () => {
    downloadCsv(
      `admin-hizmet-gecmisi-${selectedLogDate.toISOString().slice(0, 10)}.csv`,
      ["ucus", "sandalye", "yolcu_tipi", "terminal", "atanan", "kaydeden", "created_at"],
      filteredServiceHistoryLogs.map((service) => [
        service.flight_iata,
        service.wheelchair_id,
        service.passenger_type,
        service.terminal,
        extractAssignedStaffFromService(service) || "",
        service.created_by || "",
        service.created_at,
      ]),
    );
  };

  const handleExportDayEndReport = () => {
    const reportDate = now.toLocaleDateString("tr-TR");
    const lines = [
      `Wheelie Watch Pro - Gun Sonu Raporu (${reportDate})`,
      "",
      `Toplam hizmet: ${todayServices.length}`,
      `Eksik sandalye: ${missingWheelchairs.length}`,
      `Bakim bekleyen sandalye: ${maintenanceWheelchairs.length}`,
      `Aktif vardiya: ${activeShiftRows.length}`,
      `Aktif abone: ${summary.activeSubscribers}`,
      `Vardiyada bildirim alabilen: ${summary.onShiftSubscribers}`,
      "",
      "GUN SONU KPI OZETI:",
      ...dayEndMetrics.map((metric) => `- ${metric.title}: ${metric.value} | ${metric.detail}`),
      "",
      "UYARI MERKEZI:",
      ...operationalAlerts.map((alert) => `- [${alert.level.toUpperCase()}] ${alert.title} - ${alert.detail}`),
    ];

    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `gun-sonu-raporu-${now.toISOString().slice(0, 10)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleSyncGoogleSheets = async (silent = false) => {
    if (syncingGoogleSheets) {
      return;
    }

    setSyncingGoogleSheets(true);

    try {
      const [
        flightPlanEntries,
        { data: serviceRows, error: serviceError },
        { data: wheelchairRows, error: wheelchairError },
        { data: handoverLogRows, error: handoverError },
      ] = await Promise.all([
        fetchFlightPlanEntries(),
        supabase
          .from("wheelchair_services")
          .select("*")
          .gte("created_at", todayStartIso)
          .order("created_at", { ascending: false }),
        supabase
          .from("wheelchairs")
          .select("terminal, status"),
        supabase
          .from("action_logs")
          .select("created_at, details, performed_by")
          .eq("action", "Vardiya Devri")
          .gte("created_at", todayStartIso)
          .order("created_at", { ascending: false }),
      ]);

      if (serviceError || wheelchairError || handoverError) {
        throw serviceError || wheelchairError || handoverError;
      }

      const departureFlightEntries = flightPlanEntries.filter((entry) => Boolean(entry.departureCode));
      const flightLookup = new Map<string, FlightPlanEntry>();

      departureFlightEntries.forEach((entry) => {
        getFlightCodeMatchKeys(entry.departureCode).forEach((key) => {
          if (!flightLookup.has(key)) {
            flightLookup.set(key, entry);
          }
        });
      });

      const departures = departureFlightEntries.map((entry) => ({
        updatedAt: new Date().toISOString(),
        departureTime: entry.departureTime || "",
        airline: extractAirlineCodeFromFlightCode(entry.departureCode),
        flightCode: normalizeFlightCode(entry.departureCode),
        destination: entry.departureIATA || "",
        terminal: "",
        gate: entry.parkPosition || "",
        status: entry.specialNotes ? "noted" : "scheduled",
        delayMinutes: 0,
        plannedPosition: entry.parkPosition || "",
      }));

      const services = (serviceRows || []) as ServiceRow[];
      const specialServices = services.map((service) => {
        const visibleNotes = getVisibleServiceNotes(service.notes);
        const matchedEntry = getFlightCodeMatchKeys(service.flight_iata || "")
          .map((key) => flightLookup.get(key))
          .find(Boolean);

        return {
          createdAt: service.created_at,
          flightCode: normalizeFlightCode(service.flight_iata || ""),
          airline: matchedEntry ? extractAirlineCodeFromFlightCode(matchedEntry.departureCode) : extractAirlineCodeFromFlightCode(service.flight_iata || ""),
          destination: matchedEntry?.departureIATA || "",
          terminal: service.terminal || "",
          gate: matchedEntry?.parkPosition || "",
          passengerType: service.passenger_type || "",
          assignedStaff: extractAssignedStaffFromService(service) || "",
          createdBy: service.created_by || "",
          wheelchairId: service.wheelchair_id || "",
          specialNotes: visibleNotes || "-",
        };
      }) as Array<{
        createdAt: string;
        flightCode: string;
        airline: string;
        destination: string;
        terminal: string;
        gate: string;
        passengerType: string;
        assignedStaff: string;
        createdBy: string;
        wheelchairId: string;
        specialNotes: string;
      }>;

      const inventoryByTerminal = new Map<string, { available: number; missing: number; maintenance: number }>();
      (wheelchairRows || []).forEach((row) => {
        const terminal = (row.terminal || "GENEL").trim() || "GENEL";
        const current = inventoryByTerminal.get(terminal) || { available: 0, missing: 0, maintenance: 0 };
        if (row.status === "missing") {
          current.missing += 1;
        } else if (row.status === "maintenance") {
          current.maintenance += 1;
        } else {
          current.available += 1;
        }
        inventoryByTerminal.set(terminal, current);
      });

      const inventorySummary = Array.from(inventoryByTerminal.entries())
        .sort((left, right) => left[0].localeCompare(right[0], "tr"))
        .map(([terminal, counts]) => ({
          updatedAt: new Date().toISOString(),
          terminal,
          available: counts.available,
          missing: counts.missing,
          maintenance: counts.maintenance,
        }));

      const handovers = (handoverLogRows || []).map((log) => {
        const details = log.details || "";
        const [transitionPart = "", snapshot = "", checklist = ""] = details.split(" | ");
        const transitionMatch = transitionPart.match(/^(.*?) → (.*?) \((.*?)\)$/);

        return {
          createdAt: log.created_at,
          terminal: transitionMatch?.[3] || "",
          fromStaff: transitionMatch?.[1] || log.performed_by || "",
          toStaff: transitionMatch?.[2] || "",
          snapshot: snapshot || "",
          checklist: checklist || "",
        };
      });

      const result = await triggerGoogleSheetsSync({
        departures,
        specialServices,
        inventorySummary,
        handovers,
      });

      if (!silent) {
        toast.success(`Sheets senkronizasyonu tamamlandi (${result.upstreamStatus || 200})`);
      }
    } catch (error) {
      console.error("Sheets sync failed", error);
      if (!silent) {
        toast.error(error instanceof Error ? error.message : "Sheets senkronizasyonu basarisiz");
      }
    } finally {
      setSyncingGoogleSheets(false);
    }
  };

  useEffect(() => {
    const runAutoSync = () => {
      if (syncingGoogleSheets) {
        return;
      }

      void handleSyncGoogleSheets(true);
    };

    runAutoSync();
    const intervalId = window.setInterval(runAutoSync, 60_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [todayStartIso, syncingGoogleSheets]);

  const formatDateTime = (value: string) =>
    new Date(value).toLocaleString("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  const formatDuration = (startedAt: string) => {
    const diffMs = now.getTime() - new Date(startedAt).getTime();
    const totalMinutes = Math.max(0, Math.floor(diffMs / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}s ${minutes}dk`;
  };

  const getActionBadgeVariant = (action: string): "default" | "secondary" | "destructive" | "outline" => {
    if (action === "Vardiya Devri") {
      return "default";
    }
    if (action.includes("Konum") || action.includes("Not")) {
      return "secondary";
    }
    if (action.includes("Çıkarıldı") || action.includes("Eksik")) {
      return "destructive";
    }
    return "outline";
  };

  const parseHandoverLog = (log: ActionLog): HandoverRecord => {
    const [transitionPart = "", snapshot = "", checklist = ""] = log.details.split(" | ");
    const transitionMatch = transitionPart.match(/^(.*?) → (.*?) \((.*?)\)$/);

    return {
      id: log.id,
      fromStaff: transitionMatch?.[1] || log.performed_by,
      toStaff: transitionMatch?.[2] || "-",
      terminal: transitionMatch?.[3] || "-",
      snapshot: snapshot || "Kayit yok",
      checklist: checklist || "Checklist bilgisi yok",
      createdAt: log.created_at,
    };
  };

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const user = localStorage.getItem("userName");
    const role = localStorage.getItem("userRole");
    if (!user || role !== "admin") {
      navigate("/login");
      return;
    }
    setCurrentUser(user);
  }, [navigate]);

  useEffect(() => {
    let cancelled = false;

    const fetchRuleSummary = async () => {
      const result = await fetchAirlineTerminalRules();
      if (cancelled) {
        return;
      }

      setAirlineTerminalRules(result.rules);
      setAirlineTerminalRulesSource(result.source);
    };

    const fetchSummary = async (silent = false) => {
      const [
        { data: wheelchairs, error: wheelchairError },
        { data: shifts, error: shiftError },
        { data: logs, error: logError },
        { data: services, error: serviceError },
        { data: subscriptions, error: subscriptionError },
        { data: serviceTrends, error: serviceTrendError },
        { data: handoverTrends, error: handoverTrendError },
      ] = await Promise.all([
        supabase.from("wheelchairs").select("*"),
        supabase.from("shifts").select("*"),
        supabase.from("action_logs").select("*").order("created_at", { ascending: false }).limit(12),
        supabase.from("wheelchair_services").select("*").gte("created_at", todayStartIso).order("created_at", { ascending: false }),
        supabase.from("push_subscriptions").select("*").eq("is_active", true).order("updated_at", { ascending: false }),
        supabase.from("wheelchair_services").select("created_at, created_by").gte("created_at", trendStartIso),
        supabase.from("action_logs").select("created_at, details").eq("action", "Vardiya Devri").gte("created_at", trendStartIso),
      ]);

      if (cancelled) {
        return;
      }

      if (wheelchairError || shiftError || logError || serviceError || subscriptionError) {
        if (!silent) {
          toast.error("Admin ozet verileri yuklenemedi");
        }
        return;
      }

      const wheelchairRows = wheelchairs || [];
      const shiftRows = shifts || [];
      const subscriptionRows = subscriptions || [];
      const activeShiftNameSet = new Set(shiftRows.filter((item) => !item.ended_at).map((item) => normalizeStaffName(item.staff_name)));
      setWheelchairDetails(wheelchairRows);
      setShiftDetails(shiftRows);
      setTodayServices(services || []);
      setPushSubscriptions(subscriptionRows);
      setServiceTrendRows(serviceTrendError ? [] : ((serviceTrends || []) as ServiceTrendRow[]));
      setHandoverTrendLogs(handoverTrendError ? [] : ((handoverTrends || []) as HandoverTrendRow[]));

      const uniqueActiveStaffSet = new Set(
        shiftRows.filter((item) => !item.ended_at).map((item) => normalizeStaffName(item.staff_name))
      );

      setSummary({
        totalWheelchairs: wheelchairRows.length,
        missingWheelchairs: wheelchairRows.filter((item) => item.status === "missing").length,
        maintenanceWheelchairs: wheelchairRows.filter((item) => item.status === "maintenance").length,
        activeShifts: uniqueActiveStaffSet.size,
        activeSubscribers: subscriptionRows.length,
        onShiftSubscribers: subscriptionRows.filter((item) => activeShiftNameSet.has(normalizeStaffName(item.user_name || ""))).length,
      });

      const logRows = logs || [];
      setRecentLogs(logRows);
      setRecentHandovers(logRows.filter((item) => item.action === "Vardiya Devri").slice(0, 6).map(parseHandoverLog));
    };

    void fetchSummary();
    void fetchRuleSummary();

    const serviceChannel = supabase
      .channel("admin-summary-services")
      .on("postgres_changes", { event: "*", schema: "public", table: "wheelchair_services" }, () => {
        void fetchSummary(true);
      })
      .subscribe();

    const shiftChannel = supabase
      .channel("admin-summary-shifts")
      .on("postgres_changes", { event: "*", schema: "public", table: "shifts" }, () => {
        void fetchSummary(true);
      })
      .subscribe();

    const wheelchairsChannel = supabase
      .channel("admin-summary-wheelchairs")
      .on("postgres_changes", { event: "*", schema: "public", table: "wheelchairs" }, () => {
        void fetchSummary(true);
      })
      .subscribe();

    const logsChannel = supabase
      .channel("admin-summary-logs")
      .on("postgres_changes", { event: "*", schema: "public", table: "action_logs" }, () => {
        void fetchSummary(true);
      })
      .subscribe();

    const pushChannel = supabase
      .channel("admin-summary-push")
      .on("postgres_changes", { event: "*", schema: "public", table: "push_subscriptions" }, () => {
        void fetchSummary(true);
      })
      .subscribe();

    const rulesChannel = supabase
      .channel("admin-summary-airline-rules")
      .on("postgres_changes", { event: "*", schema: "public", table: "airline_terminal_rules" }, () => {
        void fetchRuleSummary();
      })
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(serviceChannel);
      void supabase.removeChannel(shiftChannel);
      void supabase.removeChannel(wheelchairsChannel);
      void supabase.removeChannel(logsChannel);
      void supabase.removeChannel(pushChannel);
      void supabase.removeChannel(rulesChannel);
    };
  }, [todayStartIso, trendStartIso]);

  useEffect(() => {
    let cancelled = false;

    const fetchLogsForDate = async () => {
      const dateStart = new Date(selectedLogDate.getFullYear(), selectedLogDate.getMonth(), selectedLogDate.getDate());
      const dateEnd = new Date(dateStart.getTime() + 24 * 60 * 60 * 1000);
      const dateStartIso = dateStart.toISOString();
      const dateEndIso = dateEnd.toISOString();

      const [
        { data: logs, error: logError },
        { data: services, error: serviceError },
      ] = await Promise.all([
        supabase
          .from("action_logs")
          .select("*")
          .gte("created_at", dateStartIso)
          .lt("created_at", dateEndIso)
          .order("created_at", { ascending: false }),
        supabase
          .from("wheelchair_services")
          .select("*")
          .gte("created_at", dateStartIso)
          .lt("created_at", dateEndIso)
          .order("created_at", { ascending: false }),
      ]);

      if (cancelled) {
        return;
      }

      if (logError || serviceError) {
        toast.error("Loglar yuklenemedi");
        return;
      }

      const logRows = logs || [];
      const serviceRows = services || [];
      setRecentLogs(logRows);
      setServiceHistoryLogs(serviceRows);
      setRecentHandovers(logRows.filter((item) => item.action === "Vardiya Devri").map(parseHandoverLog));
    };

    void fetchLogsForDate();

    return () => {
      cancelled = true;
    };
  }, [selectedLogDate]);

  const copyImportCommand = async () => {
    try {
      fileInputRef.current?.click();
    } catch {
      toast.error("Dosya secme alani acilamadi");
    }
  };

  const refreshScheduleState = () => {
    const nextPayload = getStoredSchedulePayload();
    setSchedulePayload(nextPayload);
    setHasCustomSchedule(hasStoredSchedulePayload());
  };

  const handleScheduleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const lowerName = file.name.toLocaleLowerCase("tr");
      let nextPayload: SchedulePayload;

      if (lowerName.endsWith(".xlsx")) {
        nextPayload = await parseScheduleWorkbook(file);
      } else {
        const text = await file.text();
        const parsed: unknown = JSON.parse(text);

        if (!isValidSchedulePayload(parsed)) {
          toast.error("Yuklenen dosya gecerli calisma programi formati degil");
          return;
        }

        nextPayload = parsed;
      }

      saveSchedulePayload(nextPayload);
      refreshScheduleState();
      toast.success("Yeni haftanin calisma programi guncellendi");
    } catch {
      toast.error("Dosya okunamadi veya Excel/JSON formati hatali");
    } finally {
      event.target.value = "";
    }
  };

  const handleResetSchedule = () => {
    clearStoredSchedulePayload();
    refreshScheduleState();
    toast.success("Varsayilan calisma programina donuldu");
  };

  const handleSaveBriefings = () => {
    const items = briefingDraft.split("\n").map((item) => item.trim()).filter(Boolean);
    if (!items.length) {
      toast.error("En az bir brifing satiri girin");
      return;
    }

    saveBriefings(items);
    setBriefingDraft(items.join("\n"));
    setCustomBriefingsActive(hasCustomBriefings());
    toast.success("Brifing ve duyurular guncellendi");
  };

  const handleResetBriefings = () => {
    resetBriefings();
    setBriefingDraft(getBriefings().join("\n"));
    setCustomBriefingsActive(hasCustomBriefings());
    toast.success("Varsayilan brifinglere donuldu");
  };

  const handleDeleteLog = async (log: ActionLog) => {
    setDeletingLogId(log.id);

    try {
      const { error } = await supabase.from("action_logs").delete().eq("id", log.id);
      if (error) {
        throw error;
      }

      setRecentLogs((prev) => prev.filter((item) => item.id !== log.id));
      if (log.action === "Vardiya Devri") {
        setRecentHandovers((prev) => prev.filter((item) => item.id !== log.id));
      }

      toast.success("Log kaydi silindi");
    } catch {
      toast.error("Log kaydi silinemedi");
    } finally {
      setDeletingLogId(null);
    }
  };

  const refreshAirlineTerminalRules = async () => {
    const result = await fetchAirlineTerminalRules();
    setAirlineTerminalRules(result.rules);
    setAirlineTerminalRulesSource(result.source);
  };

  const handleAddAirlineTerminalRule = async () => {
    const airlineCode = newRuleAirlineCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{2}$/.test(airlineCode)) {
      toast.error("Firma kodu 2 karakterli olmali (or: PC, B2)");
      return;
    }

    setSavingRule(true);
    try {
      const { error } = await supabase
        .from("airline_terminal_rules")
        .upsert({
          airline_code: airlineCode,
          terminal_code: newRuleTerminalCode,
          note: newRuleNote.trim() || null,
          is_active: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: "airline_code" });

      if (error) {
        if (isAirlineTerminalRulesTableMissing(error)) {
          const existingRules = readStoredAirlineTerminalRules();
          const nextRules = [
            ...existingRules.filter((rule) => rule.airline_code !== airlineCode),
            { airline_code: airlineCode, terminal_code: newRuleTerminalCode, note: newRuleNote.trim() || null, is_active: true },
          ].sort((left, right) => left.airline_code.localeCompare(right.airline_code, "tr"));
          saveStoredAirlineTerminalRules(nextRules);
          await refreshAirlineTerminalRules();
          toast.success(`${airlineCode} kurali cihazda kaydedildi`);
          setNewRuleAirlineCode("");
          setNewRuleNote("");
          return;
        }
        throw error;
      }

      toast.success(`${airlineCode} kurali kaydedildi`);
      setNewRuleAirlineCode("");
      setNewRuleNote("");
      await refreshAirlineTerminalRules();
    } catch {
      toast.error("Firma kurali kaydedilemedi");
    } finally {
      setSavingRule(false);
    }
  };

  const handleUpdateRuleTerminal = async (airlineCode: string, terminalCode: "T1" | "T2") => {
    setUpdatingRuleCode(airlineCode);
    try {
      const { error } = await supabase
        .from("airline_terminal_rules")
        .update({
          terminal_code: terminalCode,
          is_active: true,
          updated_at: new Date().toISOString(),
        })
        .eq("airline_code", airlineCode);

      if (error) {
        if (isAirlineTerminalRulesTableMissing(error)) {
          const nextRules = readStoredAirlineTerminalRules().map((rule) =>
            rule.airline_code === airlineCode ? { ...rule, terminal_code: terminalCode, is_active: true } : rule,
          );
          saveStoredAirlineTerminalRules(nextRules);
          await refreshAirlineTerminalRules();
          toast.success(`${airlineCode} terminali ${terminalCode} olarak cihazda guncellendi`);
          return;
        }
        throw error;
      }

      toast.success(`${airlineCode} terminali ${terminalCode} olarak guncellendi`);
      await refreshAirlineTerminalRules();
    } catch {
      toast.error("Terminal kurali guncellenemedi");
    } finally {
      setUpdatingRuleCode(null);
    }
  };

  const handleDeleteRule = async (airlineCode: string) => {
    setDeletingRuleCode(airlineCode);
    try {
      const { error } = await supabase
        .from("airline_terminal_rules")
        .delete()
        .eq("airline_code", airlineCode);

      if (error) {
        if (isAirlineTerminalRulesTableMissing(error)) {
          const nextRules = readStoredAirlineTerminalRules().filter((rule) => rule.airline_code !== airlineCode);
          saveStoredAirlineTerminalRules(nextRules.length > 0 ? nextRules : getDefaultAirlineTerminalRules());
          await refreshAirlineTerminalRules();
          toast.success(`${airlineCode} kurali cihazdan kaldirildi`);
          return;
        }
        throw error;
      }

      toast.success(`${airlineCode} kurali kaldirildi`);
      await refreshAirlineTerminalRules();
    } catch {
      toast.error("Kural silinemedi");
    } finally {
      setDeletingRuleCode(null);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("userName");
    localStorage.removeItem("userRole");
    window.location.href = "/login";
  };

  const spotlightMetrics = [
    {
      label: "Sistem Sağlığı",
      value: `${summary.totalWheelchairs - summary.missingWheelchairs - summary.maintenanceWheelchairs}/${summary.totalWheelchairs || 0}`,
      hint: "Hazır sandalye kapasitesi",
      tone: "text-emerald-300",
    },
    {
      label: "Bugünkü Hizmetler",
      value: `${todayServices.length}`,
      hint: "Açılan hizmet kaydı",
      tone: "text-cyan-300",
    },
    {
      label: "Bildirim İzni Verenler",
      value: `${summary.onShiftSubscribers}/${summary.activeSubscribers || 0}`,
      hint: "Aktif Bildirim Alanlar",
      tone: "text-amber-300",
    },
  ];

  const kpiCards = [
    {
      title: "Toplam Sandalye",
      value: summary.totalWheelchairs,
      description: "Operasyonda takip edilen toplam envanter",
      icon: Wrench,
      className: "border-primary/20 bg-[linear-gradient(135deg,hsl(var(--card))_0%,hsl(var(--card))_58%,hsl(var(--primary)/0.14)_100%)]",
      valueClassName: "text-primary",
    },
    {
      title: "Eksik Sandalye",
      value: summary.missingWheelchairs,
      description: "Anında müdahale gerektiren kayıtlar",
      icon: AlertTriangle,
      className: "border-red-500/20 bg-[linear-gradient(135deg,rgba(127,29,29,0.18),rgba(15,23,42,0.92))]",
      valueClassName: "text-red-300",
    },
    {
      title: "Bakım Bekleyen",
      value: summary.maintenanceWheelchairs,
      description: "Teknik işlem planı gereken sandalye",
      icon: DatabaseZap,
      className: "border-orange-500/20 bg-[linear-gradient(135deg,rgba(120,53,15,0.18),rgba(15,23,42,0.92))]",
      valueClassName: "text-orange-300",
    },
    {
      title: "Aktif İşlem",
      value: summary.activeShifts,
      description: "Şu anda sahada çalışan ekip",
      icon: Clock3,
      className: "border-cyan-500/20 bg-[linear-gradient(135deg,rgba(8,47,73,0.18),rgba(15,23,42,0.92))]",
      valueClassName: "text-cyan-300",
    },
    {
      title: "Bugünkü Hizmet",
      value: todayServices.length,
      description: "Gün içinde açılan toplam kayıt",
      icon: ClipboardList,
      className: "border-violet-500/20 bg-[linear-gradient(135deg,rgba(67,56,202,0.16),rgba(15,23,42,0.92))]",
      valueClassName: "text-violet-300",
    },
    {
      title: "Aktif Abone",
      value: summary.activeSubscribers,
      description: "Bildirim alabilen bağlı cihazlar",
      icon: BellRing,
      className: "border-emerald-500/20 bg-[linear-gradient(135deg,rgba(6,78,59,0.18),rgba(15,23,42,0.92))]",
      valueClassName: "text-emerald-300",
    },
  ];

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.16),transparent_28%),radial-gradient(circle_at_top_right,rgba(8,145,178,0.14),transparent_24%),hsl(var(--background))]">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-30">
        <div className="container h-14 px-4 flex items-center justify-between">
          <div>
            <h1 className="font-heading font-semibold text-lg">Admin KPI Merkezi</h1>
            <p className="text-xs text-muted-foreground">Yonetici girisi aktif: {currentUser} • {now.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/")}>
              Ana Menu
            </Button>
            <Button variant="ghost" size="sm" onClick={handleLogout} title="Cikis Yap">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="container px-4 py-6 space-y-5">
        <Card className="overflow-hidden border-primary/20 bg-[linear-gradient(135deg,hsl(var(--card))_0%,hsl(var(--card))_48%,hsl(var(--primary)/0.12)_100%)] shadow-lg shadow-primary/5">
          <CardContent className="p-0">
            <div className="grid gap-6 p-6 xl:grid-cols-[1.2fr_0.8fr] xl:items-center">
              <div className="space-y-4">
                <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs text-primary">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Yönetici Operasyon Alanı
                </div>
                <div className="space-y-2">
                  <h2 className="font-heading text-3xl leading-tight sm:text-4xl">Operasyonları anlık tek panelde yönetin.</h2>
                  <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
                    Bildirim erişimi, saha yoğunluğu, ekip ritmi ve envanter riskleri aynı kontrol yüzeyinde toplandı.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => navigate("/wheelchair-services")} className="gap-2">
                    <Users className="h-4 w-4" />
                    Hizmet Akisini Ac
                  </Button>
                  <Button variant="secondary" onClick={() => navigate("/wheelchair-system")} className="gap-2">
                    <Wrench className="h-4 w-4" />
                    Envanteri Ac
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                {spotlightMetrics.map((item) => (
                  <div key={item.label} className="rounded-2xl border border-white/10 bg-background/60 p-4 backdrop-blur-sm">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{item.label}</p>
                    <p className={`mt-2 font-heading text-3xl ${item.tone}`}>{item.value}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{item.hint}</p>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="critical" className="space-y-4">
          <TabsList className="h-auto flex-wrap justify-start gap-2 rounded-2xl border border-border bg-card/60 p-2 backdrop-blur-sm">
            <TabsTrigger value="critical" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Genel Operasyon Ekranı</TabsTrigger>
            <TabsTrigger value="management" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Yonetim Araclari</TabsTrigger>
            <TabsTrigger value="logs" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Log ve Devir</TabsTrigger>
          </TabsList>

          <TabsContent value="critical" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
              {kpiCards.map((item) => {
                const Icon = item.icon;
                return (
                  <Card key={item.title} className={item.className}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between gap-3">
                        <CardDescription className="text-muted-foreground/90">{item.title}</CardDescription>
                        <div className="rounded-xl border border-white/10 bg-background/30 p-2">
                          <Icon className="h-4 w-4 text-foreground" />
                        </div>
                      </div>
                      <CardTitle className={`text-3xl ${item.valueClassName}`}>{item.value}</CardTitle>
                      <p className="text-xs text-muted-foreground">{item.description}</p>
                    </CardHeader>
                  </Card>
                );
              })}
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
              <Card className="border-red-500/20 bg-[linear-gradient(180deg,rgba(127,29,29,0.08),rgba(15,23,42,0.04))]">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-destructive" />
                    Envanterdeki Eksik Listesi
                  </CardTitle>
                  <CardDescription>Eksik veya bakim bekleyen sandalyeler anlik izlenir.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="font-medium">Eksik Sandalyeler</p>
                      <Badge variant="destructive">{missingWheelchairs.length}</Badge>
                    </div>
                    {missingWheelchairs.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">Eksik sandalye yok.</div>
                    ) : (
                      <div className="space-y-2">
                        {missingWheelchairs.slice(0, 6).map((item) => (
                          <div key={item.id} className="rounded-xl border border-red-500/15 bg-background/60 p-3 text-sm">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium">{item.wheelchair_id}</span>
                              <Badge variant="destructive">{item.terminal}</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">Konum: {item.gate || "Bilinmiyor"}</p>
                            <p className="text-xs text-muted-foreground">Son guncelleme: {formatDateTime(item.updated_at)}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="font-medium">Bakimdaki Sandalyeler</p>
                      <Badge variant="outline">{maintenanceWheelchairs.length}</Badge>
                    </div>
                    {maintenanceWheelchairs.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">Bakim bekleyen sandalye yok.</div>
                    ) : (
                      <div className="space-y-2">
                        {maintenanceWheelchairs.slice(0, 6).map((item) => (
                          <div key={item.id} className="rounded-xl border border-orange-500/15 bg-background/60 p-3 text-sm">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium">{item.wheelchair_id}</span>
                              <Badge variant="secondary">{item.terminal}</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">Not: {item.note || "Bakim notu yok"}</p>
                            <p className="text-xs text-muted-foreground">Son guncelleme: {formatDateTime(item.updated_at)}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-cyan-500/20 bg-[linear-gradient(180deg,rgba(8,47,73,0.12),rgba(15,23,42,0.04))]">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock3 className="w-5 h-5 text-primary" />
                    Program Durumu
                  </CardTitle>
                  <CardDescription>Bugun planlanan ve su an aktif ekip durumu.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="rounded-xl border border-border bg-background/60 p-3">
                    <p className="text-xs text-muted-foreground">Yuklu Hafta</p>
                    <p className="font-medium">{currentWeekLabel}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-border bg-background/60 p-3">
                      <p className="text-xs text-muted-foreground">Planli Personel</p>
                      <p className="text-2xl font-semibold">{plannedTodayCount}</p>
                    </div>
                    <div className="rounded-xl border border-border bg-background/60 p-3">
                      <p className="text-xs text-muted-foreground">Simdi Aktif</p>
                      <p className="text-2xl font-semibold text-primary">{activeScheduleCount}</p>
                    </div>
                  </div>
                  <div className="rounded-xl border border-border bg-background/60 p-3 text-sm">
                    <p className="text-xs text-muted-foreground mb-2">Brifing Satiri</p>
                    <p>{getBriefings().length} aktif duyuru ana menude yayinda.</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
              <Card className="border-primary/20 bg-card/85">
                <CardHeader>
                  <CardTitle>Aktif Vardiya Operasyonu</CardTitle>
                  <CardDescription>Terminal bazli anlik vardiya listesi.</CardDescription>
                </CardHeader>
                <CardContent>
                  {activeShiftRows.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">Su an aktif vardiya yok.</div>
                  ) : (
                    <div className="space-y-3">
                      {activeShiftRows.map((shift) => (
                        <div key={shift.id} className="rounded-xl border border-border bg-secondary/20 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="font-medium">{shift.staff_name}</p>
                              <p className="text-xs text-muted-foreground">{shift.terminal}</p>
                            </div>
                            <Badge variant="outline">{formatDuration(shift.started_at)}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-2">Baslangic: {formatDateTime(shift.started_at)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="border-primary/20 bg-card/85 xl:col-span-2">
                <CardHeader>
                  <CardTitle>Operasyon Hizmet Panosu</CardTitle>
                  <CardDescription>
                    Bugunku Hizmet Akisi, Vardiya Performans Ekrani ve Hizmet Acma Kayitlari tek kartta listelenir.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-3">
                    <p className="text-sm font-medium">Bugunku Hizmet Akisi</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {terminalServiceSummary.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground sm:col-span-2">Bugun kayitli hizmet yok.</div>
                      ) : (
                        terminalServiceSummary.map(([terminal, count]) => (
                          <div key={terminal} className="rounded-xl border border-border bg-background/60 p-3">
                            <p className="text-xs text-muted-foreground">{terminal}</p>
                            <p className="text-2xl font-semibold">{count}</p>
                          </div>
                        ))
                      )}
                    </div>
                    {todayServices.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Son Hizmet Kayitlari</p>
                        <div className="space-y-2">
                          {todayServices.slice(0, 6).map((service) => (
                            <div key={service.id} className="rounded-xl border border-border bg-secondary/20 p-3 text-sm">
                              <div className="flex items-center justify-between gap-3">
                                <span className="font-medium">{service.wheelchair_id}</span>
                                <Badge variant="outline">{service.flight_iata}</Badge>
                              </div>
                              <p className="text-xs text-muted-foreground mt-1">{service.terminal} • {service.passenger_type}</p>
                              <p className="text-xs text-muted-foreground">{formatDateTime(service.created_at)}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <p className="text-sm font-medium">Vardiya Performans Ekrani</p>
                    {shiftPerformance.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">Bugün performans verisi oluşmadı.</div>
                    ) : (
                      <div className="grid gap-3 lg:grid-cols-2">
                        {shiftPerformance.slice(0, 8).map((item) => (
                          <div key={item.staffName} className="rounded-2xl border border-border bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01))] p-4">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="font-medium">{item.staffName}</p>
                                <p className="text-xs text-muted-foreground">{Array.from(item.terminals).join(", ") || "Terminal bilgisi yok"}</p>
                              </div>
                              <Badge variant={item.onShift ? "default" : "outline"}>{item.onShift ? "Vardiyada" : "Vardiya dışı"}</Badge>
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                              <div className="rounded-xl border border-border bg-background/70 p-3">
                                <p className="text-xs text-muted-foreground">Atanan Hizmet</p>
                                <p className="text-lg font-semibold">{item.assignedCount}</p>
                              </div>
                              <div className="rounded-xl border border-border bg-background/70 p-3">
                                <p className="text-xs text-muted-foreground">Açtığı Kayıt</p>
                                <p className="text-lg font-semibold">{item.createdCount}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <p className="text-sm font-medium">Hizmet Acma Kayitlari (Bugun)</p>
                    {createdBySummary.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">Bugün açılmış hizmet kaydı bulunmuyor.</div>
                    ) : (
                      <div className="space-y-2">
                        {createdBySummary.map((item) => (
                          <div key={item.staffName} className="rounded-xl border border-border bg-background/60 p-3">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="font-medium">{item.staffName}</p>
                                <p className="text-xs text-muted-foreground">Terminal: {Array.from(item.terminals).join(", ") || "-"}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-lg font-semibold text-primary">{item.createdCount}</p>
                                <p className="text-xs text-muted-foreground">hizmet açtı</p>
                              </div>
                            </div>
                            <p className="mt-2 text-xs text-muted-foreground">Son kayıt: {formatDateTime(item.lastCreatedAt)}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="border-primary/20 bg-[linear-gradient(180deg,hsl(var(--card)),hsl(var(--primary)/0.05))]">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>Operasyon Gün Sonu Özeti</CardTitle>
                  <Button type="button" variant="outline" size="sm" onClick={handleExportDayEndReport}>
                    Raporu Indir
                  </Button>
                </div>
                <CardDescription>Diger gunlere gore yuzdelik degisim ozeti.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {dayEndMetrics.map((metric) => (
                    <div key={metric.title} className="rounded-xl border border-border bg-background/60 p-4">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">{metric.title}</p>
                      <p className={`mt-2 text-2xl font-semibold ${metric.tone}`}>{metric.value}</p>
                      <p className="mt-2 text-xs text-muted-foreground">{metric.detail}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="management" className="space-y-4">
            <Card className="border-primary/20 bg-[linear-gradient(140deg,hsl(var(--card)),hsl(var(--primary)/0.08))]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DatabaseZap className="h-5 w-5 text-primary" />
                  Google Sheets Senkronizasyonu
                </CardTitle>
                <CardDescription>
                  Departure ucuslari, ozel durumlu hizmetler, envanter ve vardiya devirleri tek tikla Sheets'e yazilir.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-2">
                <Button type="button" onClick={() => void handleSyncGoogleSheets()} disabled={syncingGoogleSheets} className="gap-2">
                  <RefreshCw className={`h-4 w-4 ${syncingGoogleSheets ? "animate-spin" : ""}`} />
                  {syncingGoogleSheets ? "Senkronize ediliyor..." : "Sheets'e Senkronize Et"}
                </Button>
                <p className="text-xs text-muted-foreground">Gunluk veriler bugunun saatine gore yeniden yazilir.</p>
              </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Card className="border-border hover:border-primary/40 transition-colors cursor-pointer" onClick={() => navigate("/wheelchair-system")}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Wrench className="w-4 h-4 text-primary" />
                    Sandalye Sistemi
                  </CardTitle>
                  <CardDescription>Durum, eksik ve envanter kontrolu.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button className="w-full">Ac</Button>
                </CardContent>
              </Card>

              <Card className="border-border hover:border-primary/40 transition-colors cursor-pointer" onClick={() => navigate("/work-schedule")}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <CalendarDays className="w-4 h-4 text-primary" />
                    Calisma Programi
                  </CardTitle>
                  <CardDescription>Haftalik vardiya ve ekip gorunumu.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button className="w-full" variant="secondary">Ac</Button>
                </CardContent>
              </Card>

              <Card className="border-border hover:border-primary/40 transition-colors cursor-pointer" onClick={() => navigate("/flights")}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Plane className="w-4 h-4 text-primary" />
                    Ucuslar
                  </CardTitle>
                  <CardDescription>Ucus listesi ve operasyon akisina gecis.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button className="w-full" variant="secondary">Ac</Button>
                </CardContent>
              </Card>

              <Card className="border-border hover:border-primary/40 transition-colors cursor-pointer" onClick={() => navigate("/wheelchair-services")}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Users className="w-4 h-4 text-primary" />
                    Hizmet Kayitlari
                  </CardTitle>
                  <CardDescription>Wheelchair service kayitlarini yonet.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button className="w-full" variant="secondary">Ac</Button>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <DatabaseZap className="w-4 h-4 text-primary" />
                Yeni Haftanin Calisma Programini Yukle
              </CardTitle>
              <CardDescription>Yeni hafta `.xlsx` veya mevcut JSON dosyasini secince uygulamadaki calisma programi aninda guncellenir.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/json,.json"
                className="hidden"
                onChange={handleScheduleUpload}
              />
              <div className="rounded-md border border-border bg-secondary/40 p-3 text-sm">
                <p className="text-xs text-muted-foreground mb-1">Yuklu hafta</p>
                <p className="font-medium">{currentWeekLabel}</p>
              </div>
              <Alert>
                <CalendarDays className="h-4 w-4" />
                <AlertTitle>{hasCustomSchedule ? "Ozel hafta aktif" : "Varsayilan hafta aktif"}</AlertTitle>
                <AlertDescription>
                  Excel veya JSON yuklemesi tarayicida saklanir. Ayni cihaz ve tarayicida calisma programi sayfasi yeni veriyi kullanir.
                </AlertDescription>
              </Alert>
              <div className="flex flex-wrap gap-2">
                <Button onClick={copyImportCommand}>Excel Dosyasi Sec</Button>
                <Button variant="outline" onClick={() => navigate("/work-schedule")}>Programi Ac</Button>
                {hasCustomSchedule && (
                  <Button variant="secondary" onClick={handleResetSchedule}>Varsayilana Don</Button>
                )}
              </div>
            </CardContent>
              </Card>

              <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Megaphone className="w-4 h-4 text-primary" />
                Brifing ve Duyuru Ayarlari
              </CardTitle>
              <CardDescription>Ana menudeki brifing alanini satir satir buradan yonet.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Alert>
                <Megaphone className="h-4 w-4" />
                <AlertTitle>{customBriefingsActive ? "Ozel brifing listesi aktif" : "Varsayilan brifing listesi aktif"}</AlertTitle>
                <AlertDescription>Her satir ana menude ayri bir duyuru olarak gosterilir.</AlertDescription>
              </Alert>
              <Textarea
                value={briefingDraft}
                onChange={(event) => setBriefingDraft(event.target.value)}
                placeholder="Her satira bir brifing yaz"
                className="min-h-[180px]"
              />
              <div className="flex flex-wrap gap-2">
                <Button onClick={handleSaveBriefings}>Brifingleri Kaydet</Button>
                {customBriefingsActive && (
                  <Button variant="secondary" onClick={handleResetBriefings}>Varsayilana Don</Button>
                )}
              </div>
            </CardContent>
              </Card>

              <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Plane className="w-4 h-4 text-primary" />
                Firma - Terminal Kurallari
              </CardTitle>
              <CardDescription>Hizmetler ekraninda kullanilan aktif havayolu terminal eslesmeleri.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Alert>
                <Plane className="h-4 w-4" />
                <AlertTitle>
                  {airlineTerminalRulesSource === "database"
                    ? "Supabase kurallari aktif"
                    : airlineTerminalRulesSource === "local"
                      ? "Cihazdaki yerel kurallar aktif"
                      : "Varsayilan fallback kurallari aktif"}
                </AlertTitle>
                <AlertDescription>
                  {airlineTerminalRulesSource === "database"
                    ? "Degisiklikler Hizmetler ekrani ve admin gorunumu tarafina anlik yansir."
                    : airlineTerminalRulesSource === "local"
                      ? "airline_terminal_rules tablosu canli Supabase'te olmadigi icin ekle/guncelle/sil islemleri bu cihazin tarayicisinda saklaniyor."
                      : "Tablo okunamazsa kod icindeki varsayilan eslesmeler kullanilir."}
                </AlertDescription>
              </Alert>

              <div className="rounded-xl border border-border bg-background/60 p-3 space-y-3">
                <p className="text-sm font-medium">Yeni Firma Kurali Ekle</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Input
                    value={newRuleAirlineCode}
                    onChange={(event) => setNewRuleAirlineCode(event.target.value.toUpperCase())}
                    maxLength={2}
                    placeholder="Kod (B2)"
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant={newRuleTerminalCode === "T1" ? "default" : "outline"}
                      onClick={() => setNewRuleTerminalCode("T1")}
                      className="flex-1"
                    >
                      T1
                    </Button>
                    <Button
                      type="button"
                      variant={newRuleTerminalCode === "T2" ? "default" : "outline"}
                      onClick={() => setNewRuleTerminalCode("T2")}
                      className="flex-1"
                    >
                      T2
                    </Button>
                  </div>
                  <Button type="button" onClick={handleAddAirlineTerminalRule} disabled={savingRule}>
                    {savingRule ? "Kaydediliyor..." : "Ekle / Guncelle"}
                  </Button>
                </div>
                <Input
                  value={newRuleNote}
                  onChange={(event) => setNewRuleNote(event.target.value)}
                  placeholder="Opsiyonel not"
                />
              </div>

              <div className="space-y-2">
                {airlineTerminalRules.map((rule) => (
                  <div key={rule.airline_code} className="rounded-xl border border-border bg-background/60 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">{rule.airline_code}</p>
                        <p className="text-xs text-muted-foreground">{rule.note || "Aciklama yok"}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={rule.terminal_code === "T1" ? "default" : "secondary"}>{rule.terminal_code}</Badge>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={updatingRuleCode === rule.airline_code}
                          onClick={() => handleUpdateRuleTerminal(rule.airline_code, rule.terminal_code === "T1" ? "T2" : "T1")}
                        >
                          {updatingRuleCode === rule.airline_code ? "..." : "Degistir"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={deletingRuleCode === rule.airline_code}
                          onClick={() => handleDeleteRule(rule.airline_code)}
                        >
                          {deletingRuleCode === rule.airline_code ? "..." : "Sil"}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="logs" className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
              <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1">
                  <CardTitle>Son Islemler</CardTitle>
                  <CardDescription>En son kaydedilen operasyon hareketleri.</CardDescription>
                </div>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-fit">
                      <CalendarDays className="w-4 h-4 mr-2" />
                      {selectedLogDate.toLocaleDateString("tr-TR", { year: "numeric", month: "2-digit", day: "2-digit" })}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                    <Calendar
                      mode="single"
                      selected={selectedLogDate}
                      onSelect={(date) => date && setSelectedLogDate(date)}
                      disabled={(date) => date > new Date()}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-4 grid gap-2 md:grid-cols-[1fr_220px_auto]">
                <Input
                  value={logSearchQuery}
                  onChange={(event) => setLogSearchQuery(event.target.value)}
                  placeholder="Log ara: islem, sandalye, detay, personel"
                />
                <select
                  value={logActionFilter}
                  onChange={(event) => setLogActionFilter(event.target.value)}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="all">Tum islemler</option>
                  {logActionOptions.map((action) => (
                    <option key={action} value={action}>{action}</option>
                  ))}
                </select>
                <Button type="button" variant="outline" onClick={handleExportRecentLogsCsv}>
                  Log CSV Al
                </Button>
              </div>

              {recentLogs.length === 0 ? (
                <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
                  Henuz log kaydi yok.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Islem</TableHead>
                      <TableHead>Sandalye</TableHead>
                      <TableHead>Detay</TableHead>
                      <TableHead>Personel</TableHead>
                      <TableHead className="text-right">Saat</TableHead>
                      <TableHead className="text-right">Sil</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRecentLogs.slice(0, 8).map((log) => (
                      <TableRow key={log.id}>
                        <TableCell>
                          <Badge variant={getActionBadgeVariant(log.action)}>{log.action}</Badge>
                        </TableCell>
                        <TableCell className="font-medium">{log.wheelchair_id}</TableCell>
                        <TableCell className="max-w-[280px] text-sm text-muted-foreground">{log.details}</TableCell>
                        <TableCell>{log.performed_by || "-"}</TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">{formatDateTime(log.created_at)}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteLog(log)}
                            disabled={deletingLogId === log.id}
                            title="Log kaydini sil"
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              <div className="mt-6">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <h4 className="text-sm font-semibold">Gecmis Hizmet Kayitlari</h4>
                  <Badge variant="secondary">{filteredServiceHistoryLogs.length}</Badge>
                </div>

                <div className="mb-4 grid gap-2 md:grid-cols-[1fr_160px_auto]">
                  <Input
                    value={serviceSearchQuery}
                    onChange={(event) => setServiceSearchQuery(event.target.value)}
                    placeholder="Hizmet ara: ucus, sandalye, personel"
                  />
                  <select
                    value={serviceTerminalFilter}
                    onChange={(event) => setServiceTerminalFilter(event.target.value)}
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="all">Tum terminaller</option>
                    <option value="T1">T1</option>
                    <option value="T2">T2</option>
                  </select>
                  <Button type="button" variant="outline" onClick={handleExportServiceHistoryCsv}>
                    Hizmet CSV Al
                  </Button>
                </div>

                {serviceHistoryLogs.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
                    Secilen tarihte hizmet kaydi yok.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ucus</TableHead>
                        <TableHead>Sandalye</TableHead>
                        <TableHead>Yolcu Tipi</TableHead>
                        <TableHead>Terminal</TableHead>
                        <TableHead>Atanan</TableHead>
                        <TableHead>Kaydeden</TableHead>
                        <TableHead className="text-right">Saat</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredServiceHistoryLogs.slice(0, 12).map((service) => {
                        const assignedStaff = extractAssignedStaffFromService(service) || "-";

                        return (
                          <TableRow key={service.id}>
                            <TableCell className="font-medium">{service.flight_iata}</TableCell>
                            <TableCell>{service.wheelchair_id}</TableCell>
                            <TableCell>{service.passenger_type}</TableCell>
                            <TableCell>{service.terminal || "-"}</TableCell>
                            <TableCell>{assignedStaff}</TableCell>
                            <TableCell>{service.created_by || "-"}</TableCell>
                            <TableCell className="text-right text-sm text-muted-foreground">{formatDateTime(service.created_at)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </div>
            </CardContent>
              </Card>

              <Card>
            <CardHeader>
              <CardTitle>Son Devir Kayitlari</CardTitle>
              <CardDescription>Checklist ve terminal bazli son vardiya devirleri.</CardDescription>
            </CardHeader>
            <CardContent>
              {recentHandovers.length === 0 ? (
                <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
                  Henuz vardiya devri kaydi yok.
                </div>
              ) : (
                <ScrollArea className="h-[360px] pr-3">
                  <div className="space-y-3">
                    {recentHandovers.map((handover) => (
                      <div key={handover.id} className="rounded-lg border border-border bg-secondary/30 p-3 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-medium">{handover.fromStaff} → {handover.toStaff}</p>
                            <p className="text-xs text-muted-foreground">{handover.terminal}</p>
                          </div>
                          <Badge variant="outline">{formatDateTime(handover.createdAt)}</Badge>
                        </div>
                        <div className="space-y-1 text-sm">
                          <p><span className="text-muted-foreground">Durum:</span> {handover.snapshot}</p>
                          <p><span className="text-muted-foreground">Checklist:</span> {handover.checklist}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default AdminControlPage;