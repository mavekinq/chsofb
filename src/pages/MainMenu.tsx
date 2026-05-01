import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { Accessibility, ArrowRight, Bell, Briefcase, CalendarDays, ExternalLink, LogOut, Megaphone, Newspaper, Phone, Plane, RefreshCw, Shield, Users } from "lucide-react";
import SplashScreen from "@/components/SplashScreen";
import { BRIEFINGS_UPDATED_EVENT, getBriefings, loadBriefings } from "@/lib/briefings";
import { CELEBI_NEWS_SOURCE_URL, type CelebiNewsItem, fetchCelebiNews } from "@/lib/celebi-news";
import { fetchFlightPlanEntries } from "@/lib/flight-plan";
import { ensurePushSubscription, getNotificationPermissionState, isNotificationSupported, requiresInstalledPwaForPush, syncPushSubscriptionIfEnabled } from "@/lib/notifications";
import { getStoredSchedulePayload, loadSchedulePayload, type SchedulePayload, WORK_SCHEDULE_UPDATED_EVENT } from "@/lib/work-schedule";
import { toast } from "sonner";

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
    if (!user) {
      navigate("/login");
      return;
    }
    setCurrentUser(user);
    setIsAdminUser(role === "admin");
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
        }
      } catch (error) {
        if (!cancelled) {
          setNewsItems([]);
          setNewsError("Çelebi haberleri şu an yüklenemedi.");
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

      const [servicesResult, wheelchairsResult, flightEntries] = await Promise.all([
        supabase.from("wheelchair_services").select("id", { count: "exact", head: true }),
        supabase.from("wheelchairs").select("id, status"),
        fetchFlightPlanEntries(),
      ]);

      if (cancelled) {
        return;
      }

      if (servicesResult.error || wheelchairsResult.error) {
        setSummaryLoading(false);
        return;
      }

      const arrivalFlights = flightEntries.filter((entry) => entry.arrivalCode).length;
      const departureFlights = flightEntries.filter((entry) => entry.departureCode).length;

      setDashboardSummary({
        activeServices: servicesResult.count ?? 0,
        missingWheelchairs: wheelchairsResult.data?.filter((wheelchair) => wheelchair.status === "missing").length ?? 0,
        arrivalFlights,
        departureFlights,
      });
      setSummaryLoading(false);
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

  if (splash) return <SplashScreen isVisible={splash} />;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.18),transparent_34%),radial-gradient(circle_at_top_right,hsl(176_60%_35%/0.2),transparent_26%),hsl(var(--background))]">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-30">
        <div className="container h-14 px-4 flex items-center justify-between">
          <div>
            <h1 className="font-heading font-semibold text-lg">Operasyon Merkezi</h1>
            <p className="hidden text-xs text-muted-foreground sm:block">{nowLabel}</p>
          </div>
          <div className="flex items-center gap-2">
            {isAdminUser && (
              <Button variant="outline" size="sm" onClick={() => navigate("/admin")} className="gap-1.5">
                <Shield className="w-4 h-4" />
                <span className="hidden sm:inline">Admin Menüsü</span>
              </Button>
            )}
            <span className="text-sm text-muted-foreground hidden sm:inline">{currentUser}</span>
            <Button variant="ghost" size="sm" onClick={handleLogout} title="Cikis Yap">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="container px-4 py-6 space-y-5">
        <section className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
          <Card className="overflow-hidden border-primary/20 bg-[linear-gradient(135deg,hsl(var(--card))_0%,hsl(var(--card))_45%,hsl(var(--primary)/0.12)_100%)] shadow-lg shadow-primary/5">
            <CardContent className="p-0">
              <div className="grid gap-6 p-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
                <div className="space-y-4">
                  <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs text-primary">
                    <Briefcase className="h-3.5 w-3.5" />
                    Canlı Operasyon Merkezi
                  </div>
                  <div className="space-y-2">
                    <h2 className="font-heading text-3xl leading-tight sm:text-4xl">Saha operasyonlarını tek merkezden yönetin.</h2>
                    <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
                      Aktif hizmet bildirimleri ve vardiya yönetimi ile eksik ekipman ve bildirim hizmeti ile kolaylık sağlar.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button className="gap-2" onClick={() => navigate("/wheelchair-services")}>
                      Hizmetlere Git
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                    <Button variant="secondary" className="gap-2" onClick={() => navigate("/wheelchair-system")}>
                      <Accessibility className="h-4 w-4" />
                      Sandalye takibi
                    </Button>
                    <Button variant="outline" className="gap-2" onClick={() => navigate("/work-schedule")}>
                      <CalendarDays className="h-4 w-4" />
                      Vardiya Planı
                    </Button>
                    <Button variant="outline" className="gap-2" onClick={() => navigate("/flights")}>
                      <Plane className="h-4 w-4" />
                      Uçuşlar
                    </Button>
                    <Button variant="outline" className="gap-2" onClick={() => navigate("/directory")}>
                      <Phone className="h-4 w-4" />
                      Çelebi Rehber
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-background/60 p-4 backdrop-blur-sm">
                    <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Verilen Hizmet</p>
                    <p className="mt-2 font-heading text-4xl text-primary">{summaryLoading ? "..." : dashboardSummary.activeServices}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Bugüne kadar verdiğimiz hizmet</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-background/60 p-4 backdrop-blur-sm">
                    <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Aktif Vardiya</p>
                    <p className="mt-2 font-heading text-4xl text-cyan-300">{activeScheduleCount}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Sahada çalışan ekip sayısı</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-background/60 p-4 backdrop-blur-sm">
                    <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Eksik Sandalye</p>
                    <p className="mt-2 font-heading text-4xl text-rose-300">{summaryLoading ? "..." : dashboardSummary.missingWheelchairs}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Müdahale gerektiren ekipman</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-background/60 p-4 backdrop-blur-sm">
                    <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Günlük Uçuş</p>
                    <p className="mt-2 font-heading text-4xl text-emerald-300">{summaryLoading ? "..." : totalFlights}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {summaryLoading
                        ? "Gelen ve giden uçaklar hesaplanıyor"
                        : `Gelen ${dashboardSummary.arrivalFlights} • Giden ${dashboardSummary.departureFlights}`}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-primary/20 bg-card/80 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="w-5 h-5 text-primary" />
                Bildirimleri Açın
              </CardTitle>
              <CardDescription>
                {needsInstalledPwa
                  ? "iPhone/iPad tarafında arka plan bildirimi için uygulamayı Ana Ekrana Ekle ile kurup oradan açın."
                  : "Gerçek arka plan bildirimleri için bu cihazı web push aboneliğine ekleyin."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border border-border bg-secondary/40 p-4">
                <p className="text-sm font-medium">{notificationStatusLabel}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {needsInstalledPwa
                    ? "Safari sekmesi yerine ana ekrana eklenmiş uygulama açıkken izin verin; aksi halde arka plan push gelmez."
                    : "Abonelik açıldıktan sonra hizmet bildirimleri uygulama arka plandayken de bu cihaza gönderilir."}
                </p>
              </div>
              <Button className="w-full" onClick={handleNotificationPermission} disabled={notificationRequesting || notificationPermission === "granted" || notificationPermission === "denied" || notificationPermission === "unsupported"}>
                {notificationPermission === "granted"
                  ? "Push Aktif"
                  : notificationRequesting
                    ? "Abonelik Açılıyor..."
                    : "Push Bildirimlerini Aç"}
              </Button>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Card className="border-border/80 bg-card/70 transition-colors hover:border-primary/40">
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex-1">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Operasyon</p>
                <p className="mt-2 font-heading text-2xl">Hizmetler</p>
                <p className="mt-1 text-xs text-muted-foreground">Uçuşlar için hizmet bilgisi oluştur</p>
              </div>
              <Button size="sm" className="shrink-0" onClick={() => navigate("/wheelchair-services")}>Aç</Button>
            </CardContent>
          </Card>

          <Card className="border-border/80 bg-card/70 transition-colors hover:border-primary/40">
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Envanter</p>
                <p className="mt-2 font-heading text-2xl">Sandalyeler</p>
                <p className="mt-1 text-xs text-muted-foreground">Durum, konum ve bakım takibi</p>
              </div>
              <Button size="sm" variant="secondary" className="shrink-0" onClick={() => navigate("/wheelchair-system")}>Aç</Button>
            </CardContent>
          </Card>

          <Card className="border-border/80 bg-card/70 transition-colors hover:border-primary/40">
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Vardiya</p>
                <p className="mt-2 font-heading text-2xl">Program</p>
                <p className="mt-1 text-xs text-muted-foreground">Anlık ekip ve vardiya takibi</p>
              </div>
              <Button size="sm" variant="secondary" className="shrink-0" onClick={() => navigate("/work-schedule")}>Aç</Button>
            </CardContent>
          </Card>

          <Card className="border-border/80 bg-card/70 transition-colors hover:border-primary/40">
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Uçuş</p>
                <p className="mt-2 font-heading text-2xl">Uçuşlar</p>
                <p className="mt-1 text-xs text-muted-foreground">Uçuş listeleri ve park bilgileri</p>
              </div>
              <Button size="sm" variant="secondary" className="shrink-0" onClick={() => navigate("/flights")}>Aç</Button>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          <Card className="border-border/80 bg-card/80 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Megaphone className="w-5 h-5 text-primary" />
                Haftalık Duyuru Panosu
              </CardTitle>
              <CardDescription>Haftalık brifingler ve ekip içi duyurular.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {briefings.map((item, index) => (
                  <div key={item} className="rounded-xl border border-border bg-secondary/30 px-3 py-3 text-sm">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/15 px-1 text-[11px] text-primary">{index + 1}</span>
                      <span className="leading-6">{item}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/80 bg-card/80 backdrop-blur-sm">
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1.5">
                <CardTitle className="flex items-center gap-2">
                  <Newspaper className="w-5 h-5 text-primary" />
                  Çelebi Haberleri
                </CardTitle>
                <CardDescription>Son kurumsal haberler ve dış operasyon gündemi.</CardDescription>
              </div>

              <Button variant="outline" size="sm" asChild>
                <a href={CELEBI_NEWS_SOURCE_URL} target="_blank" rel="noreferrer">
                  Tüm Haberler
                  <ExternalLink className="w-4 h-4" />
                </a>
              </Button>
            </CardHeader>
            <CardContent>
              {newsLoading ? (
                <div className="space-y-2 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Haberler yükleniyor...
                  </div>
                </div>
              ) : newsError ? (
                <div className="rounded-md border border-border px-3 py-4 text-sm text-muted-foreground space-y-3">
                  <p>{newsError}</p>
                  <Button variant="secondary" size="sm" asChild>
                    <a href={CELEBI_NEWS_SOURCE_URL} target="_blank" rel="noreferrer">
                      Haber Sayfasını Aç
                    </a>
                  </Button>
                </div>
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                  {newsItems.map((item) => (
                    <a
                      key={item.url}
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border border-border p-4 transition-colors hover:border-primary/40 hover:bg-accent/30"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-2">
                          <p className="font-medium leading-snug">{item.title}</p>
                          <p className="text-sm text-muted-foreground leading-6">{item.summary}</p>
                        </div>
                        <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
};

export default MainMenu;