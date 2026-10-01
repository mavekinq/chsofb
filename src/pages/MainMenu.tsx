import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { Accessibility, Activity, AlertTriangle, ArrowRight, Bell, CalendarDays, CheckCircle2, ChevronRight, ClipboardCheck, ExternalLink, LogOut, Megaphone, Newspaper, Phone, Plane, RefreshCw, Settings, Shield, Star, Users } from "lucide-react";
import SplashScreen from "@/components/SplashScreen";
import { BRIEFINGS_UPDATED_EVENT, getBriefings, loadBriefings } from "@/lib/briefings";
import { CELEBI_NEWS_SOURCE_URL, type CelebiNewsItem, fetchCelebiNews } from "@/lib/celebi-news";
import { fetchFlightPlanEntries } from "@/lib/flight-plan";
import { readOfflineCache, saveOfflineCache } from "@/lib/offline-cache";
import { ensurePushSubscription, getNotificationPermissionState, isNotificationSupported, requiresInstalledPwaForPush, syncPushSubscriptionIfEnabled } from "@/lib/notifications";
import { getStoredSchedulePayload, loadSchedulePayload, type SchedulePayload, WORK_SCHEDULE_UPDATED_EVENT } from "@/lib/work-schedule";
import { hasSpecialMemberAccess } from "@/lib/special-member";
import { hasTeslimAccess } from "@/lib/teslim-access";
import { toast } from "sonner";
import menuBackground from "../../arkaplanmenu.avif";

type DashboardSummary = {
  activeServices: number;
  missingWheelchairs: number;
  arrivalFlights: number;
  departureFlights: number;
};

const SHIFT_PATTERN = /^(\d{2})(\d{2})-(\d{2})(\d{2})$/;

const getMinuteOfDay = (date: Date) => date.getHours() * 60 + date.getMinutes();

const parseShift = (value: string) => {
  const normalized = (value || "").trim().replace(/\s+/g, "");
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

const isActiveForToday = (shiftValue: string, minuteNow: number) => {
  const parsed = parseShift(shiftValue);
  if (!parsed) {
    return false;
  }

  if (!parsed.overnight) {
    return minuteNow >= parsed.start && minuteNow < parsed.end;
  }

  return minuteNow >= parsed.start || minuteNow < parsed.end;
};

const isActiveFromPreviousDayOvernight = (shiftValue: string, minuteNow: number) => {
  const parsed = parseShift(shiftValue);
  if (!parsed || !parsed.overnight) {
    return false;
  }

  return minuteNow < parsed.end;
};

const DASHBOARD_SUMMARY_CACHE_KEY = "main-menu:dashboard-summary";
const MAIN_MENU_NEWS_CACHE_KEY = "main-menu:news-items";

type QuickActionProps = {
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  accent?: "blue" | "cyan" | "neutral" | "amber";
  badge?: string;
};

const QuickAction = ({
  icon,
  title,
  description,
  onClick,
  accent = "neutral",
  badge,
}: QuickActionProps) => {
  const accentClasses = {
    blue: "border-primary/30 bg-primary/[0.07] hover:border-primary/60 hover:bg-primary/[0.11]",
    cyan: "border-cyan-400/25 bg-cyan-400/[0.05] hover:border-cyan-400/50 hover:bg-cyan-400/[0.09]",
    amber: "border-amber-400/25 bg-amber-400/[0.05] hover:border-amber-400/50 hover:bg-amber-400/[0.09]",
    neutral: "border-white/[0.08] bg-white/[0.025] hover:border-primary/40 hover:bg-white/[0.045]",
  };

  const iconClasses = {
    blue: "bg-primary/10 text-primary",
    cyan: "bg-cyan-400/10 text-cyan-300",
    amber: "bg-amber-400/10 text-amber-300",
    neutral: "bg-white/[0.05] text-slate-300",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex min-h-[92px] w-full items-center gap-3 rounded-2xl border p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/10 active:scale-[0.99] ${accentClasses[accent]}`}
    >
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${iconClasses[accent]}`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-heading text-sm font-semibold text-foreground">{title}</span>
          {badge && (
            <span className="rounded-full bg-cyan-400/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-cyan-300">
              {badge}
            </span>
          )}
        </span>
        <span className="mt-1 block line-clamp-2 text-xs leading-5 text-muted-foreground">
          {description}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
    </button>
  );
};

type StatCardProps = {
  icon: ReactNode;
  label: string;
  value: number | string;
  description: string;
  tone?: "blue" | "cyan" | "green" | "red";
  loading?: boolean;
};

const StatCard = ({
  icon,
  label,
  value,
  description,
  tone = "blue",
  loading = false,
}: StatCardProps) => {
  const tones = {
    blue: { icon: "bg-primary/10 text-primary", value: "text-primary", dot: "bg-primary" },
    cyan: { icon: "bg-cyan-400/10 text-cyan-300", value: "text-cyan-300", dot: "bg-cyan-300" },
    green: { icon: "bg-emerald-400/10 text-emerald-300", value: "text-emerald-300", dot: "bg-emerald-300" },
    red: { icon: "bg-rose-400/10 text-rose-300", value: "text-rose-300", dot: "bg-rose-300" },
  };
  const currentTone = tones[tone];

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#0c1422]/80 p-4 transition-colors hover:border-white/[0.14]">
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${currentTone.icon}`}>{icon}</div>
        <span className={`mt-2 h-1.5 w-1.5 rounded-full ${currentTone.dot}`} />
      </div>
      <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">{label}</p>
      <p className={`mt-1 font-heading text-4xl font-semibold tracking-tight ${currentTone.value}`}>
        {loading ? <span className="inline-block h-9 w-10 animate-pulse rounded-md bg-white/[0.06]" /> : value}
      </p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
    </div>
  );
};

const MainMenu = () => {
  const navigate = useNavigate();
  const [splash, setSplash] = useState(true);
  const [currentUser, setCurrentUser] = useState("");
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [briefings, setBriefings] = useState<string[]>(() => getBriefings());
  const [newsItems, setNewsItems] = useState<CelebiNewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [newsError, setNewsError] = useState("");
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary>({
    activeServices: 0,
    missingWheelchairs: 0,
    arrivalFlights: 0,
    departureFlights: 0,
  });
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [notificationPermission, setNotificationPermission] = useState(() => getNotificationPermissionState());
  const [notificationRequesting, setNotificationRequesting] = useState(false);
  const [needsInstalledPwa, setNeedsInstalledPwa] = useState(() => requiresInstalledPwaForPush());
  const [now, setNow] = useState(new Date());
  const [schedulePayload, setSchedulePayload] = useState<SchedulePayload>(() => getStoredSchedulePayload());
  const [hasSpecialAccess, setHasSpecialAccess] = useState(false);
  const [hasTeslimUserAccess, setHasTeslimUserAccess] = useState(false);

  const nowLabel = useMemo(
    () => now.toLocaleString("tr-TR", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    }),
    [now],
  );

  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const minuteNow = getMinuteOfDay(now);
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
  const totalFlights = dashboardSummary.arrivalFlights + dashboardSummary.departureFlights;

  useEffect(() => {
    const user = localStorage.getItem("userName");
    const role = localStorage.getItem("userRole");
    const securityNumber = localStorage.getItem("securityNumber");
    if (!user) {
      navigate("/login");
      return;
    }
    setCurrentUser(user);
    setIsAdminUser(role === "admin");
    setHasSpecialAccess(hasSpecialMemberAccess(securityNumber));
    setHasTeslimUserAccess(hasTeslimAccess(securityNumber, role));
  }, [navigate]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSplash(false), 1800);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const syncSchedule = (event?: Event) => {
      const customEvent = event as CustomEvent<SchedulePayload> | undefined;
      setSchedulePayload(customEvent?.detail || getStoredSchedulePayload());
    };

    void loadSchedulePayload().then((payload) => {
      setSchedulePayload(payload);
    });

    window.addEventListener(WORK_SCHEDULE_UPDATED_EVENT, syncSchedule as EventListener);
    window.addEventListener("storage", syncSchedule);

    return () => {
      window.removeEventListener(WORK_SCHEDULE_UPDATED_EVENT, syncSchedule as EventListener);
      window.removeEventListener("storage", syncSchedule);
    };
  }, []);

  useEffect(() => {
    const handleBriefingsUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<string[]>;
      setBriefings(customEvent.detail || getBriefings());
    };

    const handleStorage = () => setBriefings(getBriefings());

    void loadBriefings().then((items) => {
      setBriefings(items);
    });

    window.addEventListener(BRIEFINGS_UPDATED_EVENT, handleBriefingsUpdated as EventListener);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener(BRIEFINGS_UPDATED_EVENT, handleBriefingsUpdated as EventListener);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadNews = async () => {
      setNewsLoading(true);
      setNewsError("");

      try {
        const items = await fetchCelebiNews();
        if (!cancelled) {
          setNewsItems(items);
          saveOfflineCache(MAIN_MENU_NEWS_CACHE_KEY, items);
        }
      } catch (error) {
        if (!cancelled) {
          const cachedItems = readOfflineCache<CelebiNewsItem[]>(MAIN_MENU_NEWS_CACHE_KEY) || [];
          setNewsItems(cachedItems);
          setNewsError(cachedItems.length > 0 ? "Çevrimdışı: kayıtlı haberler gösteriliyor." : "Çelebi haberleri şu an yüklenemedi.");
        }
      } finally {
        if (!cancelled) {
          setNewsLoading(false);
        }
      }
    };

    void loadNews();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadDashboardSummary = async () => {
      setSummaryLoading(true);

      try {
        const [servicesResult, wheelchairsResult, flightEntries] = await Promise.all([
          supabase.from("wheelchair_services").select("id", { count: "exact", head: true }),
          supabase.from("wheelchairs").select("id, status"),
          fetchFlightPlanEntries(),
        ]);

        if (cancelled) {
          return;
        }

        if (servicesResult.error || wheelchairsResult.error) {
          throw new Error("Dashboard summary fetch failed");
        }

        const arrivalFlights = flightEntries.filter((entry) => entry.arrivalCode).length;
        const departureFlights = flightEntries.filter((entry) => entry.departureCode).length;

        const nextSummary = {
          activeServices: servicesResult.count ?? 0,
          missingWheelchairs: wheelchairsResult.data?.filter((wheelchair) => wheelchair.status === "missing").length ?? 0,
          arrivalFlights,
          departureFlights,
        };

        setDashboardSummary(nextSummary);
        saveOfflineCache(DASHBOARD_SUMMARY_CACHE_KEY, nextSummary);
      } catch (error) {
        if (!cancelled) {
          const cachedSummary = readOfflineCache<DashboardSummary>(DASHBOARD_SUMMARY_CACHE_KEY);
          if (cachedSummary) {
            setDashboardSummary(cachedSummary);
          }
        }
      } finally {
        if (!cancelled) {
          setSummaryLoading(false);
        }
      }
    };

    void loadDashboardSummary();

    const serviceChannel = supabase
      .channel("main-menu-services")
      .on("postgres_changes", { event: "*", schema: "public", table: "wheelchair_services" }, () => {
        void loadDashboardSummary();
      })
      .subscribe();
    const wheelchairChannel = supabase
      .channel("main-menu-wheelchairs")
      .on("postgres_changes", { event: "*", schema: "public", table: "wheelchairs" }, () => {
        void loadDashboardSummary();
      })
      .subscribe();
    const flightRefreshTimer = window.setInterval(() => {
      void loadDashboardSummary();
    }, 60000);

    return () => {
      cancelled = true;
      window.clearInterval(flightRefreshTimer);
      void supabase.removeChannel(serviceChannel);
      void supabase.removeChannel(wheelchairChannel);
    };
  }, []);

  useEffect(() => {
    if (!isNotificationSupported()) {
      setNotificationPermission("unsupported");
      return;
    }

    const updatePermission = () => {
      setNotificationPermission(getNotificationPermissionState());
      setNeedsInstalledPwa(requiresInstalledPwaForPush());
    };
    updatePermission();
    window.addEventListener("focus", updatePermission);

    return () => {
      window.removeEventListener("focus", updatePermission);
    };
  }, []);

  useEffect(() => {
    if (!currentUser || notificationPermission !== "granted") {
      return;
    }

    void syncPushSubscriptionIfEnabled(currentUser).catch((error) => {
      toast.error(error instanceof Error ? error.message : "Push aboneliği yenilenemedi");
    });
  }, [currentUser, notificationPermission]);

  const handleNotificationPermission = async () => {
    setNotificationRequesting(true);

    try {
      await ensurePushSubscription(currentUser || localStorage.getItem("userName") || "Personel");
      setNotificationPermission(getNotificationPermissionState());
      toast.success("Push bildirimleri etkinleştirildi");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Bildirim izni alınamadı");
    } finally {
      setNotificationRequesting(false);
    }
  };

  const notificationStatusLabel = {
    granted: "bildirimler aktif",
    denied: "Bildirim izni engellendi",
    default: "Bildirim izni bekleniyor",
    unsupported: "Bu cihazda desteklenmiyor",
  }[notificationPermission];

  const handleLogout = () => {
    localStorage.removeItem("userName");
    localStorage.removeItem("userRole");
    window.location.href = "/login";
  };

  if (splash) {
    return <SplashScreen isVisible={splash} />;
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#070D18] text-foreground">
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -left-40 -top-40 h-[420px] w-[420px] rounded-full bg-primary/[0.08] blur-3xl" />
        <div className="absolute right-[-160px] top-[10%] h-[420px] w-[420px] rounded-full bg-cyan-400/[0.055] blur-3xl" />
        <div className="absolute bottom-[-200px] left-[30%] h-[500px] w-[500px] rounded-full bg-primary/[0.035] blur-3xl" />
      </div>

      <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-[#070D18]/85 backdrop-blur-xl">
        <div className="mx-auto flex h-[76px] max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-primary/[0.08] text-primary shadow-lg shadow-primary/[0.08]">
              <Plane className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate font-heading text-base font-semibold tracking-tight sm:text-lg">Operasyon Merkezi</h1>
              <p className="hidden truncate text-[11px] text-muted-foreground sm:block">Çelebi Hava Servisi • {nowLabel}</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            {isAdminUser && (
              <Button variant="ghost" size="icon" onClick={() => navigate("/admin")} title="Admin Menüsü" className="h-10 w-10 rounded-xl text-muted-foreground hover:bg-white/[0.05] hover:text-foreground">
                <Shield className="h-[18px] w-[18px]" />
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={() => navigate("/settings")} title="Ayarlar" className="h-10 w-10 rounded-xl text-muted-foreground hover:bg-white/[0.05] hover:text-foreground">
              <Settings className="h-[18px] w-[18px]" />
            </Button>
            <div className="mx-1 hidden h-6 w-px bg-white/[0.08] sm:block" />
            <span className="hidden max-w-[150px] truncate text-sm text-muted-foreground md:block">{currentUser}</span>
            <Button variant="ghost" size="icon" onClick={handleLogout} title="Çıkış Yap" className="h-10 w-10 rounded-xl text-muted-foreground hover:bg-rose-500/10 hover:text-rose-300">
              <LogOut className="h-[18px] w-[18px]" />
            </Button>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-[1440px] space-y-6 px-4 py-5 pb-28 sm:px-6 sm:py-7 lg:px-8">
        <section className="relative isolate overflow-hidden rounded-[28px] border border-primary/20 bg-[#09111e] shadow-2xl shadow-black/20">
          <img
            src={menuBackground}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full object-cover object-center opacity-45"
          />
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(7,13,24,0.96)_0%,rgba(7,13,24,0.82)_48%,rgba(7,13,24,0.55)_100%)]" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_80%_35%,hsl(var(--primary)/0.2),transparent_36%),linear-gradient(0deg,rgba(7,13,24,0.28),transparent_55%)]" />

          <div className="relative grid min-h-[330px] gap-8 p-6 sm:p-8 lg:grid-cols-[1fr_0.8fr] lg:p-10">
            <div className="flex flex-col justify-center">
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/25 bg-primary/[0.07] px-3.5 py-1.5 text-xs font-medium text-primary">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                </span>
                Canlı Operasyon Merkezi
              </div>
              <div className="mt-5 max-w-[700px]">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">
                  Hoş geldin{currentUser ? `, ${currentUser}` : ""}
                </p>
                <h2 className="font-heading text-[clamp(2.2rem,5vw,4.5rem)] font-semibold leading-[0.98] tracking-[-0.04em] text-slate-50">
                  Saha operasyonlarını <span className="text-primary">tek merkezden</span> yönetin.
                </h2>
                <p className="mt-5 max-w-xl text-sm leading-6 text-slate-400 sm:text-base">
                  Aktif hizmetler, uçuşlar, ekipmanlar ve vardiyaları tek ekrandan takip edin. Operasyonun nabzı burada.
                </p>
              </div>
              <div className="mt-7 flex flex-wrap gap-3">
                <Button onClick={() => navigate("/wheelchair-services")} className="h-12 rounded-xl bg-primary px-5 font-semibold text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary/90">
                  Hizmetlere Git <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <div className="flex h-12 items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] px-4 text-xs font-medium text-emerald-300">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,.7)]" />
                  Sistem Aktif
                </div>
              </div>
            </div>

            <div className="relative hidden lg:flex lg:items-end lg:justify-end">
              <div className="w-full max-w-[410px] rounded-3xl border border-white/[0.12] bg-[#07101d]/55 p-5 shadow-xl shadow-black/10 backdrop-blur-md">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">Operasyon Durumu</p>
                    <p className="mt-1 font-heading text-lg font-semibold">Antalya Havalimanı</p>
                  </div>
                  <Activity className="h-5 w-5 text-cyan-300" />
                </div>
                <div className="mt-5 grid grid-cols-3 gap-2">
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
                    <p className="text-[9px] uppercase tracking-wider text-slate-500">Vardiya</p>
                    <p className="mt-1 font-heading text-xl font-semibold text-cyan-300">{activeScheduleCount}</p>
                  </div>
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
                    <p className="text-[9px] uppercase tracking-wider text-slate-500">Hizmet</p>
                    <p className="mt-1 font-heading text-xl font-semibold text-primary">{summaryLoading ? "—" : dashboardSummary.activeServices}</p>
                  </div>
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
                    <p className="text-[9px] uppercase tracking-wider text-slate-500">Uçuş</p>
                    <p className="mt-1 font-heading text-xl font-semibold text-emerald-300">{summaryLoading ? "—" : totalFlights}</p>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2 border-t border-white/[0.06] pt-4 text-xs text-slate-400">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  Operasyon sistemleri çalışıyor
                </div>
              </div>
            </div>
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-end justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-primary">Hızlı Erişim</p>
              <h3 className="mt-1 font-heading text-xl font-semibold">Operasyonlar</h3>
            </div>
            <p className="hidden text-xs text-muted-foreground sm:block">Sık kullanılan işlemler</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <QuickAction icon={<Accessibility className="h-5 w-5" />} title="Sandalye Takibi" description="Durum, konum ve ekipman takibi" accent="blue" onClick={() => navigate("/wheelchair-system")} />
            <QuickAction icon={<CalendarDays className="h-5 w-5" />} title="Vardiya Planı" description="Anlık ekip ve vardiya programı" onClick={() => navigate("/work-schedule")} />
            <QuickAction icon={<Plane className="h-5 w-5" />} title="Uçuşlar" description="Gelen ve giden uçuş bilgileri" onClick={() => navigate("/flights")} />
            <QuickAction icon={<Phone className="h-5 w-5" />} title="Çelebi Rehber" description="Ekip ve iletişim bilgileri" onClick={() => navigate("/directory")} />
            {hasTeslimUserAccess && (
              <QuickAction icon={<ClipboardCheck className="h-5 w-5" />} title="Teslim Operasyonu" description="Teslim süreçlerini yönet" accent="cyan" badge="Özel" onClick={() => navigate("/teslim")} />
            )}
            {hasSpecialAccess && (
              <QuickAction icon={<Star className="h-5 w-5" />} title="Chef-Daily" description="Departure kontrol paneli" accent="amber" badge="Özel" onClick={() => navigate("/chef-daily")} />
            )}
          </div>
        </section>

        <section className="overflow-hidden rounded-[26px] border border-white/[0.07] bg-[#0a1220]/75 p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-500">Canlı Veriler</p>
              <h3 className="mt-1 font-heading text-xl font-semibold">Operasyon Özeti</h3>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.025] px-3 py-1.5 text-[10px] text-slate-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Canlı
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={<Users className="h-5 w-5" />} label="Aktif Vardiya" value={activeScheduleCount} description="Şu anda sahada çalışan ekip" tone="cyan" />
            <StatCard icon={<CheckCircle2 className="h-5 w-5" />} label="Verilen Hizmet" value={dashboardSummary.activeServices} description="Kayıtlardaki toplam hizmet" tone="blue" loading={summaryLoading} />
            <StatCard icon={<AlertTriangle className="h-5 w-5" />} label="Eksik Sandalye" value={dashboardSummary.missingWheelchairs} description="Müdahale gerektiren ekipman" tone="red" loading={summaryLoading} />
            <StatCard icon={<Plane className="h-5 w-5" />} label="Günlük Uçuş" value={totalFlights} description={`Gelen ${dashboardSummary.arrivalFlights} • Giden ${dashboardSummary.departureFlights}`} tone="green" loading={summaryLoading} />
          </div>
        </section>

        <section className="rounded-[24px] border border-primary/15 bg-[linear-gradient(110deg,#0c1727,#0b1421)] p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-4">
              <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${notificationPermission === "granted" ? "bg-emerald-400/10 text-emerald-300" : "bg-primary/10 text-primary"}`}>
                {notificationPermission === "granted" ? <CheckCircle2 className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-heading font-semibold">Operasyon Bildirimleri</h3>
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${notificationPermission === "granted" ? "bg-emerald-400/10 text-emerald-300" : "bg-white/[0.05] text-slate-400"}`}>
                    {notificationStatusLabel}
                  </span>
                </div>
                <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
                  {needsInstalledPwa
                    ? "iPhone/iPad tarafında arka plan bildirimi için uygulamayı Ana Ekrana Ekle ile kurup oradan açın."
                    : "Hizmet bildirimlerini bu cihazda arka planda da alabilmek için push bildirimlerini etkinleştirin."}
                </p>
              </div>
            </div>
            <Button onClick={handleNotificationPermission} disabled={notificationRequesting || notificationPermission === "granted" || notificationPermission === "denied" || notificationPermission === "unsupported"} variant={notificationPermission === "granted" ? "secondary" : "default"} className="h-11 shrink-0 rounded-xl">
              {notificationPermission === "granted" ? "Push Aktif" : notificationRequesting ? "Aktifleştiriliyor..." : "Bildirimleri Aç"}
            </Button>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
          <Card className="overflow-hidden rounded-[24px] border-white/[0.07] bg-[#0b1422]/75">
            <CardHeader className="border-b border-white/[0.06] px-5 py-4">
              <CardTitle className="flex items-center gap-2 text-base"><Megaphone className="h-4 w-4 text-primary" />Haftalık Duyuru</CardTitle>
              <CardDescription className="text-xs">Ekip içi brifingler ve operasyon duyuruları.</CardDescription>
            </CardHeader>
            <CardContent className="p-4">
              {briefings.length > 0 ? (
                <div className="space-y-2">
                  {briefings.map((item, index) => (
                    <div key={`${item}-${index}`} className="group rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 transition-colors hover:border-primary/20 hover:bg-primary/[0.025]">
                      <div className="flex items-start gap-3">
                        <span className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">{index + 1}</span>
                        <span className="text-xs leading-5 text-slate-300">{item}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-white/[0.08] p-5 text-center text-xs text-muted-foreground">Henüz yayınlanmış bir duyuru bulunmuyor.</div>
              )}
            </CardContent>
          </Card>

          <Card className="overflow-hidden rounded-[24px] border-white/[0.07] bg-[#0b1422]/75">
            <CardHeader className="border-b border-white/[0.06] px-5 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base"><Newspaper className="h-4 w-4 text-primary" />Çelebi Haberleri</CardTitle>
                  <CardDescription className="mt-1 text-xs">Son kurumsal haberler ve operasyon gündemi.</CardDescription>
                </div>
                <Button variant="outline" size="sm" asChild className="h-8 rounded-lg border-white/[0.08] bg-white/[0.02] text-xs">
                  <a href={CELEBI_NEWS_SOURCE_URL} target="_blank" rel="noreferrer">Tüm Haberler<ExternalLink className="ml-1.5 h-3.5 w-3.5" /></a>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              {newsLoading ? (
                <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] p-5 text-xs text-muted-foreground"><RefreshCw className="h-4 w-4 animate-spin" />Haberler yükleniyor...</div>
              ) : newsError ? (
                <div className="rounded-xl border border-white/[0.06] p-5">
                  <p className="text-xs leading-5 text-muted-foreground">{newsError}</p>
                  <Button variant="secondary" size="sm" asChild className="mt-3 h-9 rounded-lg text-xs">
                    <a href={CELEBI_NEWS_SOURCE_URL} target="_blank" rel="noreferrer">Haber Sayfasını Aç</a>
                  </Button>
                </div>
              ) : newsItems.length > 0 ? (
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {newsItems.map((item) => (
                    <a key={item.url} href={item.url} target="_blank" rel="noreferrer" className="group rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 transition-all hover:border-primary/25 hover:bg-primary/[0.025]">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/[0.08] text-primary"><Newspaper className="h-4 w-4" /></div>
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-xs font-semibold leading-5 text-slate-200">{item.title}</p>
                          <p className="mt-1.5 line-clamp-3 text-[11px] leading-5 text-muted-foreground">{item.summary}</p>
                        </div>
                        <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                      </div>
                    </a>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-white/[0.08] p-5 text-center text-xs text-muted-foreground">Haber bulunamadı.</div>
              )}
            </CardContent>
          </Card>
        </section>

        <div className="flex flex-col gap-2 border-t border-white/[0.06] pt-4 text-[10px] text-slate-600 sm:flex-row sm:items-center sm:justify-between">
          <span>Operasyon Merkezi • {nowLabel}</span>
          <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Sistem bağlantısı aktif</span>
        </div>
      </main>
    </div>
  );
};

export default MainMenu;