import { useState, useEffect, useCallback } from "react";
import { Plane, Users, Filter, Clock, Accessibility } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import SplashScreen from "@/components/SplashScreen";
import FlightSidebar from "@/components/FlightSidebar";
import WheelchairCard, { Wheelchair, WheelchairStatus } from "@/components/WheelchairCard";
import ShiftDialog from "@/components/ShiftDialog";
import LocationDialog from "@/components/LocationDialog";
import HistoryLog from "@/components/HistoryLog";

const TERMINALS = ["İç Hat", "T1", "T2"];

const Index = () => {
  const [splash, setSplash] = useState(true);
  const [activeTab, setActiveTab] = useState("İç Hat");
  const [showFlights, setShowFlights] = useState(false);
  const [showShift, setShowShift] = useState(false);
  const [showLocation, setShowLocation] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [missingOnly, setMissingOnly] = useState(false);
  const [wheelchairs, setWheelchairs] = useState<Wheelchair[]>([]);
  const [selectedChairId, setSelectedChairId] = useState<string | null>(null);

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
    await supabase.from("action_logs").insert({
      wheelchair_id: chair.wheelchair_id,
      action: "Durum Değişikliği",
      details: `${status}`,
      performed_by: "Personel",
    });
    toast.success(`${chair.wheelchair_id} durumu güncellendi`);
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
    await supabase.from("action_logs").insert({
      wheelchair_id: chair.wheelchair_id,
      action: "Konum Değişikliği",
      details: `→ ${gate}`,
      performed_by: "Personel",
    });
    toast.success(`${chair.wheelchair_id} konumu güncellendi`);
    setSelectedChairId(null);
  };

  const filtered = wheelchairs.filter((w) => {
    const terminalMatch = w.terminal === activeTab;
    const statusMatch = missingOnly ? w.status === "missing" : true;
    return terminalMatch && statusMatch;
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
            <h1 className="font-heading font-bold text-lg hidden sm:block">Tekerlekli Sandalye Takip</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowFlights(true)} className="gap-1.5">
              <Plane className="w-4 h-4" />
              <span className="hidden sm:inline">Uçuşlar</span>
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowShift(true)} className="gap-1.5">
              <Users className="w-4 h-4" />
              <span className="hidden sm:inline">Vardiya</span>
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowHistory(!showHistory)} className="gap-1.5">
              <Clock className="w-4 h-4" />
              <span className="hidden sm:inline">Geçmiş</span>
            </Button>
          </div>
        </div>
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

      <FlightSidebar isOpen={showFlights} onClose={() => setShowFlights(false)} />
      <ShiftDialog open={showShift} onOpenChange={setShowShift} />
      <LocationDialog open={showLocation} onOpenChange={setShowLocation} onConfirm={handleLocationConfirm} />
    </div>
  );
};

export default Index;
