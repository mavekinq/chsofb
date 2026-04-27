import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Plane, Users, Filter, Clock, Accessibility, PackagePlus, Phone, LogOut, Menu, X, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { triggerGoogleSheetsSync } from "@/lib/google-sheets-sync";
import { fetchFlightPlanEntries, getFlightCodeMatchKeys, normalizeFlightCode } from "@/lib/flight-plan";
import { extractAssignedStaffFromService, getVisibleServiceNotes } from "@/lib/wheelchair-service-utils";
import SplashScreen from "@/components/SplashScreen";

import WheelchairCard, { Wheelchair, WheelchairStatus } from "@/components/WheelchairCard";
import ShiftDialog from "@/components/ShiftDialog";
import LocationDialog from "@/components/LocationDialog";
import NoteDialog from "../components/NoteDialog";
import HistoryLog from "@/components/HistoryLog";
import WheelchairManageDialog from "@/components/WheelchairManageDialog";

const TERMINALS = ["İç Hat", "T1", "T2"];

// Helper function to get current user name
const getCurrentUser = (): string => {
  return localStorage.getItem("userName") || "Bilinmiyor";
};

// Helper function to logout
const handleLogout = () => {
  localStorage.removeItem("userName");
  localStorage.removeItem("userRole");
  window.location.href = "/login";
};

const Index = () => {
  const navigate = useNavigate();
  const [splash, setSplash] = useState(true);
  const [activeTab, setActiveTab] = useState("İç Hat");
  const [showShift, setShowShift] = useState(false);
  const [showLocation, setShowLocation] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [missingOnly, setMissingOnly] = useState(false);
  const [wheelchairs, setWheelchairs] = useState<Wheelchair[]>([]);
  const [selectedChairId, setSelectedChairId] = useState<string | null>(null);
  const [selectedNoteChairId, setSelectedNoteChairId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [currentUser, setCurrentUser] = useState<string>("");
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Check if user is logged in on mount
  useEffect(() => {
    const user = localStorage.getItem("userName");
    if (!user) {
      navigate("/login");
    } else {
      setCurrentUser(user);
    }
  }, [navigate]);

  useEffect(() => {
    const timer = setTimeout(() => setSplash(false), 2800);
    return () => clearTimeout(timer);
  }, []);

  const fetchWheelchairs = useCallback(async () => {
    const { data, error } = await supabase.from("wheelchairs").select("*");
    if (error) {
      console.error(error);
      return;
    }
    setWheelchairs((data || []) as Wheelchair[]);
  }, []);

  useEffect(() => {
    fetchWheelchairs();
    const channel = supabase
      .channel("wheelchairs_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "wheelchairs" }, () => {
        fetchWheelchairs();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchWheelchairs]);

  const handleStatusChange = async (id: string, status: WheelchairStatus) => {
    const chair = wheelchairs.find((w) => w.id === id);
    if (!chair) return;
    const { error } = await supabase.from("wheelchairs").update({ status }).eq("id", id);
    if (error) { toast.error("Durum güncellenemedi"); return; }
    setWheelchairs((prev) => prev.map((w) => (w.id === id ? { ...w, status } : w)));
    await supabase.from("action_logs").insert({
      wheelchair_id: chair.wheelchair_id,
      action: "Durum Değişikliği",
      details: `${status}`,
      performed_by: currentUser,
    });
    toast.success(`${chair.wheelchair_id} durumu güncellendi`);

    // Google Sheets sync
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
            airline: matched ? matched.departureCode.replace(/\d/g, "").trim() : (svc.flight_iata || "").replace(/\d/g, "").trim(),
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
          airline: e.departureCode.replace(/\d/g, "").trim(),
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
        console.error("Post-status-change Sheets sync failed:", syncErr);
      }
    })();
  };

  const handleLocationChange = (id: string) => {
    setSelectedChairId(id);
    setShowLocation(true);
  };

  const handleLocationConfirm = async (gate: string) => {
    if (!selectedChairId) return;
    const chair = wheelchairs.find((w) => w.id === selectedChairId);
    if (!chair) return;
    const { error } = await supabase.from("wheelchairs").update({ gate }).eq("id", selectedChairId);
    if (error) { toast.error("Konum güncellenemedi"); return; }
    setWheelchairs((prev) => prev.map((w) => (w.id === selectedChairId ? { ...w, gate } : w)));
    await supabase.from("action_logs").insert({
      wheelchair_id: chair.wheelchair_id,
      action: "Konum Değişikliği",
      details: `→ ${gate}`,
      performed_by: currentUser,
    });
    toast.success(`${chair.wheelchair_id} konumu güncellendi`);
    setSelectedChairId(null);
  };

  const handleNoteChange = (id: string) => {
    const chair = wheelchairs.find((w) => w.id === id);
    if (!chair) return;
    setSelectedNoteChairId(id);
    setNoteText(chair.note ?? "");
    setShowNote(true);
  };

  const handleNoteConfirm = async (note: string) => {
    if (!selectedNoteChairId) return;
    const chair = wheelchairs.find((w) => w.id === selectedNoteChairId);
    if (!chair) return;
    const { error } = await supabase.from("wheelchairs").update({ note }).eq("id", selectedNoteChairId);
    if (error) {
      console.error("Note save error:", error);
      toast.error("Not kaydedilemedi: " + (error.message || JSON.stringify(error)));
      return;
    }
    setWheelchairs((prev) => prev.map((w) => (w.id === selectedNoteChairId ? { ...w, note } : w)));
    await supabase.from("action_logs").insert({
      wheelchair_id: chair.wheelchair_id,
      action: "Not Güncellendi",
      details: note || "Not silindi",
      performed_by: currentUser,
    });
    toast.success(`${chair.wheelchair_id} notu güncellendi`);
    setSelectedNoteChairId(null);
    setNoteText("");
    setShowNote(false);
  };

  const filtered = wheelchairs.filter((w) => {
    const query = searchQuery.trim().toLocaleLowerCase("tr");
    const terminalMatch = w.terminal === activeTab;
    const statusMatch = missingOnly ? w.status === "missing" : true;
    const searchMatch =
      !query ||
      w.wheelchair_id.toLocaleLowerCase("tr").includes(query) ||
      (w.gate || "").toLocaleLowerCase("tr").includes(query) ||
      (w.note || "").toLocaleLowerCase("tr").includes(query);
    return terminalMatch && statusMatch && searchMatch;
  });

  const counts = {
    available: wheelchairs.filter((w) => w.terminal === activeTab && w.status === "available").length,
    missing: wheelchairs.filter((w) => w.terminal === activeTab && w.status === "missing").length,
    maintenance: wheelchairs.filter((w) => w.terminal === activeTab && w.status === "maintenance").length,
  };

  if (splash) return <SplashScreen isVisible={splash} />;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-30">
        <div className="container flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <Accessibility className="w-4 h-4 text-primary" />
            </div>
            <h1 className="font-heading font-bold text-lg">Tekerlekli Sandalye Takip</h1>
          </div>

          {/* Masaüstü menü */}
          <div className="hidden md:flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/flights")} className="gap-1.5">
              <Plane className="w-4 h-4" />
              Uçuşlar
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open("https://docs.google.com/forms/d/e/1FAIpQLSfUTbfp60Z8zg-tmYMFvTbgWMhMgz1RaID8xJZOH__Xal9XVA/viewform?usp=header", "_blank")}
              className="gap-1.5"
            >
              <Phone className="w-4 h-4" />
              Telsiz Takip
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/wheelchair-services")} className="gap-1.5">
              <Users className="w-4 h-4" />
              Hizmetler
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowShift(true)} className="gap-1.5">
              <Users className="w-4 h-4" />
              Vardiya
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowHistory(!showHistory)} className="gap-1.5">
              <Clock className="w-4 h-4" />
              Geçmiş
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/work-schedule")} className="gap-1.5">
              <CalendarDays className="w-4 h-4" />
              Calisma Programi
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowManage(true)} className="gap-1.5">
              <PackagePlus className="w-4 h-4" />
              Envanter
            </Button>
            <div className="border-l border-border pl-2 ml-2 flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{currentUser}</span>
              <Button variant="ghost" size="sm" onClick={handleLogout} title="Çıkış Yap">
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Mobil hamburger butonu */}
          <div className="flex md:hidden items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleLogout} title="Çıkış Yap">
              <LogOut className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowMobileMenu(!showMobileMenu)}
            >
              {showMobileMenu ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
          </div>
        </div>

        {/* Mobil açılır menü */}
        {showMobileMenu && (
          <div className="md:hidden border-t border-border bg-card px-4 py-3 flex flex-col gap-2">
            <Button variant="ghost" size="sm" onClick={() => { navigate("/flights"); setShowMobileMenu(false); }} className="justify-start gap-2">
              <Plane className="w-4 h-4" />
              Uçuşlar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { window.open("https://docs.google.com/forms/d/e/1FAIpQLSfUTbfp60Z8zg-tmYMFvTbgWMhMgz1RaID8xJZOH__Xal9XVA/viewform?usp=header", "_blank"); setShowMobileMenu(false); }}
              className="justify-start gap-2"
            >
              <Phone className="w-4 h-4" />
              Telsiz Takip
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { navigate("/wheelchair-services"); setShowMobileMenu(false); }} className="justify-start gap-2">
              <Users className="w-4 h-4" />
              Hizmetler
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setShowShift(true); setShowMobileMenu(false); }} className="justify-start gap-2">
              <Users className="w-4 h-4" />
              Vardiya
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setShowHistory(!showHistory); setShowMobileMenu(false); }} className="justify-start gap-2">
              <Clock className="w-4 h-4" />
              Geçmiş
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { navigate("/work-schedule"); setShowMobileMenu(false); }} className="justify-start gap-2">
              <CalendarDays className="w-4 h-4" />
              Calisma Programi
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setShowManage(true); setShowMobileMenu(false); }} className="justify-start gap-2">
              <PackagePlus className="w-4 h-4" />
              Envanter
            </Button>
            <div className="border-t border-border pt-2 mt-1">
              <span className="text-sm text-muted-foreground px-2">{currentUser}</span>
            </div>
          </div>
        )}
      </header>

      <main className="container px-4 py-6">
        {showHistory ? (
          <div>
            <Button variant="ghost" size="sm" onClick={() => setShowHistory(false)} className="mb-4">
              ← Panoya Dön
            </Button>
            <HistoryLog />
          </div>
        ) : (
          <>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
                <TabsList className="bg-secondary">
                  {TERMINALS.map((t) => (
                    <TabsTrigger key={t} value={t} className="font-heading data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                      {t}
                    </TabsTrigger>
                  ))}
                </TabsList>
                <div className="flex items-center gap-2 flex-wrap">
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Sandalye ara (ID, konum, not)"
                    className="w-[240px] bg-secondary border-border"
                  />
                  <Button
                    variant={missingOnly ? "default" : "outline"}
                    size="sm"
                    onClick={() => setMissingOnly(!missingOnly)}
                    className="gap-1.5"
                  >
                    <Filter className="w-4 h-4" />
                    Sadece Eksikleri Göster
                  </Button>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3 mb-6">
                <div className="bg-card border border-border rounded-lg p-3 text-center">
                  <p className="text-2xl font-heading font-bold text-status-available">{counts.available}</p>
                  <p className="text-xs text-muted-foreground">Müsait</p>
                </div>
                <div className="bg-card border border-border rounded-lg p-3 text-center">
                  <p className="text-2xl font-heading font-bold text-status-missing">{counts.missing}</p>
                  <p className="text-xs text-muted-foreground">Eksik</p>
                </div>
                <div className="bg-card border border-border rounded-lg p-3 text-center">
                  <p className="text-2xl font-heading font-bold text-status-maintenance">{counts.maintenance}</p>
                  <p className="text-xs text-muted-foreground">Bakımda</p>
                </div>
              </div>

              {TERMINALS.map((t) => (
                <TabsContent key={t} value={t}>
                  {filtered.length === 0 ? (
                    <div className="text-center py-16 text-muted-foreground">
                      <Accessibility className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <p>Bu terminalde kayıtlı sandalye yok</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                      {filtered.map((w) => (
                        <WheelchairCard
                          key={w.id}
                          wheelchair={w}
                          onStatusChange={handleStatusChange}
                          onLocationChange={handleLocationChange}
                          onNoteChange={handleNoteChange}
                        />
                      ))}
                    </div>
                  )}
                </TabsContent>
              ))}
            </Tabs>
          </>
        )}
      </main>

      <ShiftDialog open={showShift} onOpenChange={setShowShift} wheelchairs={wheelchairs} />
      <LocationDialog open={showLocation} onOpenChange={setShowLocation} onConfirm={handleLocationConfirm} />
      <NoteDialog
        open={showNote}
        onOpenChange={setShowNote}
        initialNote={noteText}
        onConfirm={handleNoteConfirm}
      />
      <WheelchairManageDialog open={showManage} onOpenChange={setShowManage} wheelchairs={wheelchairs} />
    </div>
  );
};

export default Index;
