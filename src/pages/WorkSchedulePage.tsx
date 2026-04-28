import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CalendarDays, History, RotateCcw } from "lucide-react";
import {
  getStoredSchedulePayload,
  isCustomSchedulePayload,
  loadScheduleHistory,
  loadSchedulePayload,
  saveSchedulePayload,
  type ScheduleHistoryItem,
  type SchedulePayload,
  WORK_SCHEDULE_UPDATED_EVENT,
} from "@/lib/work-schedule";
import { toast } from "sonner";

const SHIFT_PATTERN = /^(\d{2})(\d{2})-(\d{2})(\d{2})$/;

const formatDateLabel = (isoDate: string) => {
  const d = new Date(`${isoDate}T00:00:00`);
  return d.toLocaleDateString("tr-TR", { weekday: "short", day: "2-digit", month: "2-digit" });
};

const getMinuteOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();

const parseShift = (value: string) => {
  const normalized = (value || "").trim().replace(/\s+/g, "");
  const m = normalized.match(SHIFT_PATTERN);
  if (!m) return null;

  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  const overnight = end <= start;
  return { normalized, start, end, overnight };
};

const isActiveForToday = (shiftValue: string, minuteNow: number) => {
  const parsed = parseShift(shiftValue);
  if (!parsed) return false;
  if (!parsed.overnight) return minuteNow >= parsed.start && minuteNow < parsed.end;
  return minuteNow >= parsed.start || minuteNow < parsed.end;
};

const isActiveFromPreviousDayOvernight = (shiftValue: string, minuteNow: number) => {
  const parsed = parseShift(shiftValue);
  if (!parsed || !parsed.overnight) return false;
  return minuteNow < parsed.end;
};

const TEAM_CARD_STYLES = [
  "border-l-4 border-l-primary",
  "border-l-4 border-l-emerald-500",
  "border-l-4 border-l-orange-500",
  "border-l-4 border-l-sky-500",
  "border-l-4 border-l-rose-500",
] as const;

const getTeamColorClass = (team: string) => {
  const hash = team.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return TEAM_CARD_STYLES[hash % TEAM_CARD_STYLES.length];
};

const getTerminalTag = (team: string) => {
  const t = team.toLocaleUpperCase("tr");
  if (t.includes("T2")) return "T2";
  if (t.includes("T1")) return "T1";
  if (t.includes("IC HAT") || t.includes("İC HAT") || t.includes("ICHAT") || t.includes("ICHAT")) return "Ic Hat";
  return "Genel";
};

const getPreferredSelectedDate = (weekDates: string[], todayKey: string) => {
  if (weekDates.includes(todayKey)) {
    return todayKey;
  }

  return weekDates[0] || "";
};

const WorkSchedulePage = () => {
  const navigate = useNavigate();
  const [now, setNow] = useState(new Date());
  const [query, setQuery] = useState("");
  const [payload, setPayload] = useState<SchedulePayload>(() => getStoredSchedulePayload());
  const [selectedDate, setSelectedDate] = useState(() => {
    const initialPayload = getStoredSchedulePayload();
    const initialNow = new Date();
    const initialTodayKey = `${initialNow.getFullYear()}-${String(initialNow.getMonth() + 1).padStart(2, "0")}-${String(initialNow.getDate()).padStart(2, "0")}`;
    return getPreferredSelectedDate(initialPayload.weekDates, initialTodayKey);
  });
  const [historyItems, setHistoryItems] = useState<ScheduleHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    void loadSchedulePayload().then((nextPayload) => {
      const nextNow = new Date();
      const nextTodayKey = `${nextNow.getFullYear()}-${String(nextNow.getMonth() + 1).padStart(2, "0")}-${String(nextNow.getDate()).padStart(2, "0")}`;
      setPayload(nextPayload);
      setSelectedDate((current) => (
        nextPayload.weekDates.includes(current)
          ? current
          : getPreferredSelectedDate(nextPayload.weekDates, nextTodayKey)
      ));
    });
  }, []);

  useEffect(() => {
    const handleScheduleUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<SchedulePayload>;
      const nextPayload = customEvent.detail || getStoredSchedulePayload();
      const nextToday = new Date();
      const nextTodayKey = `${nextToday.getFullYear()}-${String(nextToday.getMonth() + 1).padStart(2, "0")}-${String(nextToday.getDate()).padStart(2, "0")}`;
      setPayload(nextPayload);
      setSelectedDate((current) => (
        nextPayload.weekDates.includes(current)
          ? current
          : getPreferredSelectedDate(nextPayload.weekDates, nextTodayKey)
      ));
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key) {
        setPayload(getStoredSchedulePayload());
      }
    };

    window.addEventListener(WORK_SCHEDULE_UPDATED_EVENT, handleScheduleUpdated as EventListener);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener(WORK_SCHEDULE_UPDATED_EVENT, handleScheduleUpdated as EventListener);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const nowLabel = now.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const minuteNow = getMinuteOfDay(now);

  const todayIndex = payload.weekDates.indexOf(todayKey);
  const previousDayKey = (() => {
    if (todayIndex <= 0) return null;
    const candidate = payload.weekDates[todayIndex - 1];
    return candidate && candidate < todayKey ? candidate : null;
  })();

  useEffect(() => {
    if (!payload.weekDates.includes(selectedDate)) {
      setSelectedDate(getPreferredSelectedDate(payload.weekDates, todayKey));
    }
  }, [payload.weekDates, selectedDate, todayKey]);

  const activeNow = useMemo(() => {
    if (todayIndex === -1) return [] as Array<{ name: string; team: string; shift: string; source: "today" | "previous" }>;

    const result: Array<{ name: string; team: string; shift: string; source: "today" | "previous" }> = [];
    for (const e of payload.employees) {
      const todayShift = e.shifts[todayKey] || "";
      const prevShift = previousDayKey ? e.shifts[previousDayKey] || "" : "";
      const teamName = e.team || e.rawTeam || "Tanimsiz Ekip";

      if (isActiveForToday(todayShift, minuteNow)) {
        result.push({ name: e.name, team: teamName, shift: todayShift, source: "today" });
        continue;
      }

      if (previousDayKey && isActiveFromPreviousDayOvernight(prevShift, minuteNow)) {
        result.push({ name: e.name, team: teamName, shift: prevShift, source: "previous" });
      }
    }

    return result.sort((a, b) => a.team.localeCompare(b.team, "tr") || a.name.localeCompare(b.name, "tr"));
  }, [minuteNow, payload.employees, previousDayKey, todayIndex, todayKey]);

  const groupedByTeam = useMemo(() => {
    const map = new Map<string, Array<{ name: string; shift: string; source: "today" | "previous" }>>();
    const q = query.trim().toLocaleLowerCase("tr");
    const filtered = q
      ? activeNow.filter((p) => p.name.toLocaleLowerCase("tr").includes(q) || p.team.toLocaleLowerCase("tr").includes(q))
      : activeNow;

    for (const p of filtered) {
      if (!map.has(p.team)) map.set(p.team, []);
      map.get(p.team)?.push({ name: p.name, shift: p.shift, source: p.source });
    }
    return Array.from(map.entries());
  }, [activeNow, query]);

  const selectedDayGrouped = useMemo(() => {
    const map = new Map<string, Array<{ name: string; shift: string }>>();
    const q = query.trim().toLocaleLowerCase("tr");

    for (const e of payload.employees) {
      const shift = (e.shifts[selectedDate] || "").trim();
      if (!shift) continue;

      const parsed = parseShift(shift);
      if (!parsed) continue;

      const teamName = e.team || e.rawTeam || "Tanimsiz Ekip";
      if (q && !e.name.toLocaleLowerCase("tr").includes(q) && !teamName.toLocaleLowerCase("tr").includes(q)) {
        continue;
      }

      if (!map.has(teamName)) map.set(teamName, []);
      map.get(teamName)?.push({ name: e.name, shift });
    }

    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], "tr"));
  }, [payload.employees, query, selectedDate]);

  const selectedDayCount = useMemo(
    () => selectedDayGrouped.reduce((sum, [, people]) => sum + people.length, 0),
    [selectedDayGrouped],
  );

  const isNowMode = selectedDate === todayKey;

  const todaySummary = useMemo(() => {
    if (!payload.weekDates.includes(todayKey)) {
      return { scheduledShiftCount: 0 };
    }

    let scheduledShiftCount = 0;
    for (const e of payload.employees) {
      const value = (e.shifts[todayKey] || "").trim();
      if (!value) continue;
      if (parseShift(value)) {
        scheduledShiftCount += 1;
      }
    }

    return { scheduledShiftCount };
  }, [payload.employees, payload.weekDates, todayKey]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-30">
        <div className="container h-14 px-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-primary" />
            <h1 className="font-heading font-semibold">Calisma Programi</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={showHistory ? "secondary" : "outline"}
              size="sm"
              onClick={() => {
                setShowHistory((prev) => !prev);
                if (!showHistory && historyItems.length === 0) {
                  setHistoryLoading(true);
                  void loadScheduleHistory().then((items) => {
                    setHistoryItems(items);
                    setHistoryLoading(false);
                  });
                }
              }}
            >
              <History className="w-4 h-4 mr-1" />
              Gecmis Programlar
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/")}>
              Panoya Don
            </Button>
          </div>
        </div>
      </header>

      <main className="container px-4 py-6">
        <div className="grid gap-4 md:grid-cols-3 mb-4">
          <div className="bg-card border border-border rounded-lg p-4">
            <p className="text-xs text-muted-foreground">Simdi</p>
            <p className="text-2xl font-heading font-bold">{nowLabel}</p>
          </div>
          <div className="bg-card border border-border rounded-lg p-4">
            <p className="text-xs text-muted-foreground">Bugun</p>
            <p className="text-base font-heading font-semibold">
              {todayIndex === -1 ? "Hafta disi tarih" : formatDateLabel(todayKey)}
            </p>
          </div>
          <div className="bg-card border border-border rounded-lg p-4">
            <p className="text-xs text-muted-foreground">{isNowMode ? "Aktif Personel" : "Secili Gun Personel"}</p>
            <p className="text-2xl font-heading font-bold text-primary">{isNowMode ? activeNow.length : selectedDayCount}</p>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-4 mb-4 flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs text-muted-foreground">Veri Kaynagi</p>
            <p className="font-medium">{isCustomSchedulePayload(payload) ? "Supabase merkezi haftalik program" : "Varsayilan haftalik program"}</p>
          </div>
          <p className="text-sm text-muted-foreground">{payload.weekDates[0] && payload.weekDates[payload.weekDates.length - 1] ? `${payload.weekDates[0]} - ${payload.weekDates[payload.weekDates.length - 1]}` : "Hafta verisi yok"}</p>
        </div>

        <div className="grid gap-4 md:grid-cols-1 mb-4">
          <div className="bg-card border border-border rounded-lg p-4">
            <p className="text-xs text-muted-foreground">Bugun Planli Vardiya</p>
            <p className="text-2xl font-heading font-bold">{todaySummary.scheduledShiftCount}</p>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-4 mb-4">
          <h2 className="font-heading text-lg mb-2">Haftalik Tarihler</h2>
          <div className="flex flex-wrap gap-2">
            {payload.weekDates.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setSelectedDate(d)}
                className={`px-2.5 py-1 text-xs rounded-full border ${d === selectedDate ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
              >
                {formatDateLabel(d)}
                {d === todayKey ? " (Suan)" : ""}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-4 mb-4">
          <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
            <h2 className="font-heading text-lg">Filtreler</h2>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Isim veya ekip ara..."
              className="md:max-w-sm"
            />
          </div>
        </div>

        {isNowMode ? (
          <div className="bg-card border border-border rounded-lg p-4">
            <h2 className="font-heading text-lg mb-1">Su An Vardiyada Olanlar</h2>
            <p className="text-sm text-muted-foreground mb-4">Bolume gore aktif personel listesi.</p>

            {todayIndex === -1 ? (
              <p className="text-sm text-muted-foreground">Bu saat, yuklu haftalik programa dahil degil.</p>
            ) : groupedByTeam.length === 0 ? (
              <p className="text-sm text-muted-foreground">Bu saatte vardiyada aktif personel bulunmuyor.</p>
            ) : (
              <div className="space-y-3">
                {groupedByTeam.map(([team, people]) => (
                  <div key={team} className={`border border-border rounded-lg p-3 ${getTeamColorClass(team)}`}>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-medium">{team}</h3>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] border border-border rounded px-2 py-0.5 text-muted-foreground">
                          {getTerminalTag(team)}
                        </span>
                        <span className="text-xs text-muted-foreground">{people.length} kisi</span>
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {people.map((p) => (
                        <div key={`${team}-${p.name}-${p.shift}`} className="bg-secondary/40 rounded-md px-3 py-2">
                          <p className="text-sm font-medium">{p.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {p.shift}
                            {p.source === "previous" ? " (dun baslayan)" : ""}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg p-4 mt-4">
            <h2 className="font-heading text-lg mb-1">Secili Gun Programi</h2>
            <p className="text-sm text-muted-foreground mb-4">
              {selectedDate ? `${formatDateLabel(selectedDate)} gunundeki vardiya saatleri (ekip bazli).` : "Gun seciniz."}
            </p>

            {selectedDayGrouped.length === 0 ? (
              <p className="text-sm text-muted-foreground">Secili gunde filtreye uygun vardiya bulunmuyor.</p>
            ) : (
              <div className="space-y-3">
                {selectedDayGrouped.map(([team, people]) => (
                  <div key={`day-${team}`} className={`border border-border rounded-lg p-3 ${getTeamColorClass(team)}`}>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-medium">{team}</h3>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] border border-border rounded px-2 py-0.5 text-muted-foreground">
                          {getTerminalTag(team)}
                        </span>
                        <span className="text-xs text-muted-foreground">{people.length} kisi</span>
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {people.map((p) => (
                        <div key={`${team}-${p.name}-${p.shift}-day`} className="bg-secondary/40 rounded-md px-3 py-2">
                          <p className="text-sm font-medium">{p.name}</p>
                          <p className="text-xs text-muted-foreground">{p.shift}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Gecmis Programlar Panel */}
      {showHistory && (
        <div className="fixed inset-y-0 right-0 z-50 w-full max-w-sm border-l border-border bg-card shadow-xl flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h2 className="font-heading font-semibold flex items-center gap-2">
              <History className="w-4 h-4 text-primary" />
              Gecmis Calisma Programlari
            </h2>
            <Button variant="ghost" size="sm" onClick={() => setShowHistory(false)}>✕</Button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {historyLoading ? (
              <p className="text-sm text-muted-foreground">Yukluyor...</p>
            ) : historyItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">Henuz gecmis program kaydedilmemis.</p>
            ) : (
              historyItems.map((item) => (
                <div key={item.id} className="rounded-lg border border-border bg-background p-3 space-y-1">
                  <p className="font-medium text-sm">{item.title || "Isimsiz Program"}</p>
                  <p className="text-xs text-muted-foreground">{item.week_range}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(item.uploaded_at).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })} tarihinde eklendi
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full mt-1 gap-1"
                    onClick={async () => {
                      try {
                        await saveSchedulePayload(item.payload);
                        toast.success(`${item.title || "Program"} geri yuklendi`);
                        setShowHistory(false);
                      } catch {
                        toast.error("Program geri yuklenemedi");
                      }
                    }}
                  >
                    <RotateCcw className="w-3 h-3" />
                    Bu Programi Ac
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkSchedulePage;