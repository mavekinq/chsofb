import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { triggerGoogleSheetsSync } from "@/lib/google-sheets-sync";
import { fetchFlightPlanEntries, getFlightCodeMatchKeys, normalizeFlightCode } from "@/lib/flight-plan";
import { extractAssignedStaffFromService, getVisibleServiceNotes } from "@/lib/wheelchair-service-utils";
import { Clock, User, LogIn, LogOut, Building2 } from "lucide-react";
import type { Wheelchair } from "@/components/WheelchairCard";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const TERMINALS = ["İç Hat", "Dış Hat"];

// Wheelchair terminal mapping: shift terminali → wheelchair terminal değerleri
const TERMINAL_WC_MAP: Record<string, string[]> = {
  "İç Hat": ["İç Hat"],
  "Dış Hat": ["T1", "T2"],
};

interface Shift {
  id: string;
  staff_name: string;
  started_at: string;
  ended_at: string | null;
  terminal: string;
  created_at: string;
}

interface ShiftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wheelchairs?: Wheelchair[];
}

type HandoverForm = {
  terminal: string;
  newStaffName: string;
  wheelchairCountChecked: boolean;
  officeCleaned: boolean;
  disruptionNote: string;
};

const ShiftDialog = ({ open, onOpenChange, wheelchairs = [] }: ShiftDialogProps) => {
  const [staffName, setStaffName] = useState("");
  const [selectedTerminal, setSelectedTerminal] = useState("İç Hat");
  const [loading, setLoading] = useState(false);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loadingShifts, setLoadingShifts] = useState(true);
  const [activeTerminalTab, setActiveTerminalTab] = useState("İç Hat");
  const [handoverInput, setHandoverInput] = useState<HandoverForm | null>(null);
  const [handoverLogs, setHandoverLogs] = useState<{ details: string; created_at: string }[]>([]);

  const updateHandoverInput = (updates: Partial<HandoverForm>) => {
    setHandoverInput((prev) => (prev ? { ...prev, ...updates } : prev));
  };

  const fetchShifts = async () => {
    const { data } = await supabase
      .from("shifts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30);
    if (data) setShifts(data as Shift[]);
    setLoadingShifts(false);
  };

  const fetchHandoverLogs = async () => {
    const { data } = await supabase
      .from("action_logs")
      .select("details, created_at")
      .eq("action", "Vardiya Devri")
      .order("created_at", { ascending: false })
      .limit(30);
    if (data) setHandoverLogs(data);
  };

  useEffect(() => {
    if (open) {
      fetchShifts();
      fetchHandoverLogs();
    }
  }, [open]);

  const getActiveShift = (terminal: string) =>
    shifts.find((s) => !s.ended_at && s.terminal === terminal);

  const handleTakeShift = async () => {
    if (!staffName.trim()) {
      toast.error("Lütfen personel adını girin");
      return;
    }
    setLoading(true);
    try {
      const existing = getActiveShift(selectedTerminal);
      if (existing) {
        await supabase
          .from("shifts")
          .update({ ended_at: new Date().toISOString() })
          .eq("id", existing.id);
      }
      const { error } = await supabase.from("shifts").insert({
        staff_name: staffName.trim(),
        started_at: new Date().toISOString(),
        terminal: selectedTerminal,
      });
      if (error) throw error;
      toast.success(`${selectedTerminal} vardiyası teslim alındı: ${staffName}`);
      setStaffName("");
      await fetchShifts();
    } catch (e: any) {
      toast.error("Vardiya kaydedilemedi: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleEndShift = async (handover: HandoverForm) => {
    const { terminal, newStaffName, wheelchairCountChecked, officeCleaned, disruptionNote } = handover;

    if (!newStaffName.trim()) {
      toast.error("Lütfen devir alan personelin adını girin");
      return;
    }

    if (!wheelchairCountChecked || !officeCleaned) {
      toast.error("Devir icin checklist maddelerini tamamlayın");
      return;
    }

    const active = getActiveShift(terminal);
    if (!active) return;
    setLoading(true);
    try {
      const { error } = await supabase
        .from("shifts")
        .update({ ended_at: new Date().toISOString() })
        .eq("id", active.id);
      if (error) throw error;
      // Devir alan personel için yeni vardiya başlat
      await supabase.from("shifts").insert({
        staff_name: newStaffName.trim(),
        started_at: new Date().toISOString(),
        terminal,
      });
      // Sandalye snapshot'ını hazırla (sadece bu terminal için)
      const wcKeys = TERMINAL_WC_MAP[terminal] || [];
      const terminalWc = wheelchairs.filter((w) => wcKeys.includes(w.terminal));
      const available = terminalWc.filter((w) => w.status === "available").length;
      const missing = terminalWc.filter((w) => w.status === "missing").length;
      const maintenance = terminalWc.filter((w) => w.status === "maintenance").length;
      const notedWc = terminalWc.filter((w) => w.note).map((w) => `${w.wheelchair_id}:${w.note}`).join(", ");
      const snapshot = `✅${available} 🔴${missing} 🟠${maintenance}${notedWc ? ` | Notlu: ${notedWc}` : ""}`;
      const checklistSummary = [
        `Sayim: ${wheelchairCountChecked ? "Tamam" : "Eksik"}`,
        `Ofis: ${officeCleaned ? "Temiz" : "Eksik"}`,
        `Aksaklik: ${disruptionNote.trim() || "Yok"}`,
      ].join(" | ");
      // Devir kaydını action_logs'a yaz
      await supabase.from("action_logs").insert({
        wheelchair_id: "VARDIYA",
        action: "Vardiya Devri",
        details: `${active.staff_name} → ${newStaffName.trim()} (${terminal}) | ${snapshot} | ${checklistSummary}`,
        performed_by: active.staff_name,
      });
      toast.success(`${terminal}: ${active.staff_name} → ${newStaffName.trim()} devredildi`);
      setHandoverInput(null);
      await fetchShifts();
      await fetchHandoverLogs();

      // Google Sheets sync
      void (async () => {
        try {
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          const todayStartIso = todayStart.toISOString();
          const [flightPlanEntries, { data: allServices }, { data: wheelchairRows }, { data: handoverLogRows }] = await Promise.all([
            fetchFlightPlanEntries(),
            supabase.from("wheelchair_services").select("*").order("created_at", { ascending: false }),
            supabase.from("wheelchairs").select("terminal, status"),
            supabase.from("action_logs").select("created_at, details, performed_by").eq("action", "Vardiya Devri").gte("created_at", todayStartIso).order("created_at", { ascending: false }),
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

          const handovers = (handoverLogRows || []).map(log => {
            const [transitionPart = "", snap = "", cl = ""] = log.details.split(" | ");
            const m = transitionPart.match(/^(.*?) → (.*?) \((.*?)\)$/);
            return { createdAt: log.created_at, terminal: m?.[3] || "", fromStaff: m?.[1] || log.performed_by || "", toStaff: m?.[2] || "", snapshot: snap || "", checklist: cl || "" };
          });

          await triggerGoogleSheetsSync({ departures, specialServices, inventorySummary, handovers });
        } catch (syncErr) {
          console.error("Post-handover Sheets sync failed:", syncErr);
        }
      })();
    } catch (e: any) {
      toast.error("Vardiya kapatılamadı: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleString("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  const formatDuration = (start: string, end: string) => {
    const ms = new Date(end).getTime() - new Date(start).getTime();
    const hours = Math.floor(ms / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    return `${hours}s ${mins}dk`;
  };

  const terminalShifts = (terminal: string) =>
    shifts.filter((s) => s.terminal === terminal);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-lg max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading">Vardiya Yönetimi</DialogTitle>
        </DialogHeader>

        {/* Wheelchair Status Summary — per terminal */}
        {wheelchairs.length > 0 && (
          <div className="space-y-2">
            {TERMINALS.map((t) => {
              const wcKeys = TERMINAL_WC_MAP[t] || [];
              const twc = wheelchairs.filter((w) => wcKeys.includes(w.terminal));
              const notedWc = twc.filter((w) => w.note);
              return (
                <div key={t} className="rounded-lg border border-border bg-secondary/40 p-3 space-y-1.5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t} — Sandalye Durumu</p>
                  <div className="flex flex-wrap gap-3">
                    <span className="text-sm">✅ Müsait: <b>{twc.filter((w) => w.status === "available").length}</b></span>
                    <span className="text-sm">🔴 Eksik: <b>{twc.filter((w) => w.status === "missing").length}</b></span>
                    <span className="text-sm">🟠 Bakımda: <b>{twc.filter((w) => w.status === "maintenance").length}</b></span>
                  </div>
                  {notedWc.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Notlu sandalyeler:</p>
                      <div className="space-y-1">
                        {notedWc.map((w) => (
                          <div key={w.id} className="text-xs bg-card rounded p-1.5 border border-border flex gap-1.5">
                            <span className="font-semibold shrink-0">{w.wheelchair_id}</span>
                            {w.gate && <span className="text-muted-foreground shrink-0">· {w.gate}</span>}
                            <span className="text-muted-foreground">· {w.note}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Active shifts per terminal */}
        <div className="grid grid-cols-2 gap-3 mb-2">
          {TERMINALS.map((t) => {
            const active = getActiveShift(t);
            return (
              <div
                key={t}
                className={`rounded-lg p-3 border ${
                  active
                    ? "bg-primary/10 border-primary/30"
                    : "bg-secondary/50 border-border"
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <Building2 className="w-3.5 h-3.5 text-primary" />
                  <span className="font-heading text-xs font-semibold">{t}</span>
                </div>
                {active ? (
                  <>
                    <p className="text-sm font-semibold">{active.staff_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatTime(active.started_at)}
                    </p>
                    {handoverInput?.terminal === t ? (
                      <div className="mt-2 space-y-1.5">
                        <Input
                          value={handoverInput.newStaffName}
                          onChange={(e) => updateHandoverInput({ newStaffName: e.target.value })}
                          placeholder="Devir alan personel adı"
                          className="bg-secondary border-border text-xs h-8"
                          autoFocus
                          onKeyDown={(e) => e.key === "Enter" && handleEndShift(handoverInput)}
                        />
                        <div className="rounded-md border border-border bg-card p-2 space-y-2">
                          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Devir Checklist</p>
                          <div className="flex items-start gap-2">
                            <Checkbox
                              id={`wc-check-${t}`}
                              checked={handoverInput.wheelchairCountChecked}
                              onCheckedChange={(checked) => updateHandoverInput({ wheelchairCountChecked: checked === true })}
                            />
                            <Label htmlFor={`wc-check-${t}`} className="text-xs leading-5 cursor-pointer">
                              Sandalye sayimi ve kontrolu yapildi
                            </Label>
                          </div>
                          <div className="flex items-start gap-2">
                            <Checkbox
                              id={`office-clean-${t}`}
                              checked={handoverInput.officeCleaned}
                              onCheckedChange={(checked) => updateHandoverInput({ officeCleaned: checked === true })}
                            />
                            <Label htmlFor={`office-clean-${t}`} className="text-xs leading-5 cursor-pointer">
                              Ofis temizligi kontrol edildi
                            </Label>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Vardiyada aksaklik varsa yaz</Label>
                            <Textarea
                              value={handoverInput.disruptionNote}
                              onChange={(e) => updateHandoverInput({ disruptionNote: e.target.value })}
                              placeholder="Yoksa bos birakilabilir"
                              className="min-h-[70px] bg-secondary border-border text-xs"
                            />
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            className="flex-1 text-xs h-7"
                            onClick={() => handleEndShift(handoverInput)}
                            disabled={loading}
                          >
                            Onayla
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-7"
                            onClick={() => setHandoverInput(null)}
                            disabled={loading}
                          >
                            İptal
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2 gap-1 text-xs text-destructive border-destructive/50 w-full"
                        onClick={() => setHandoverInput({
                          terminal: t,
                          newStaffName: "",
                          wheelchairCountChecked: false,
                          officeCleaned: false,
                          disruptionNote: "",
                        })}
                        disabled={loading}
                      >
                        <LogOut className="w-3 h-3" />
                        Devret
                      </Button>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">Aktif vardiya yok</p>
                )}
              </div>
            );
          })}
        </div>

        {/* Take new shift */}
        <div className="space-y-3 border-t border-border pt-3">
          <Label className="flex items-center gap-1.5">
            <LogIn className="w-4 h-4" />
            Yeni Vardiya Teslim Al
          </Label>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Terminal</Label>
              <Select value={selectedTerminal} onValueChange={setSelectedTerminal}>
                <SelectTrigger className="bg-secondary border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {TERMINALS.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Personel</Label>
              <Input
                value={staffName}
                onChange={(e) => setStaffName(e.target.value)}
                placeholder="Ad Soyad"
                className="bg-secondary border-border"
              />
            </div>
          </div>
          <Button onClick={handleTakeShift} disabled={loading} className="w-full">
            {loading ? "Kaydediliyor..." : "Teslim Al"}
          </Button>
        </div>

        {/* Shift history by terminal */}
        <div className="border-t border-border pt-3 mt-2">
          <h3 className="font-heading text-sm font-semibold mb-2 flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-muted-foreground" />
            Vardiya Geçmişi
          </h3>
          <Tabs value={activeTerminalTab} onValueChange={setActiveTerminalTab}>
            <TabsList className="bg-secondary mb-2 w-full">
              {TERMINALS.map((t) => (
                <TabsTrigger key={t} value={t} className="flex-1 text-xs font-heading data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                  {t}
                </TabsTrigger>
              ))}
            </TabsList>
            {TERMINALS.map((t) => (
              <TabsContent key={t} value={t}>
                <div className="overflow-y-auto max-h-[260px] pr-1">
                  {loadingShifts ? (
                    <p className="text-xs text-muted-foreground text-center py-3">Yükleniyor...</p>
                  ) : terminalShifts(t).length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-3">Kayıt yok</p>
                  ) : (
                    <div className="space-y-2">
                      {terminalShifts(t).map((s) => {
                        // Bu vardiyaya ait devir kaydını bul
                        const matchLog = s.ended_at
                          ? handoverLogs.find((l) =>
                              l.details.includes(`(${t})`) &&
                              Math.abs(new Date(l.created_at).getTime() - new Date(s.ended_at!).getTime()) < 60000
                            )
                          : undefined;
                        return (
                          <div
                            key={s.id}
                            className={`rounded-lg p-2.5 text-sm border ${
                              !s.ended_at
                                ? "bg-primary/5 border-primary/20"
                                : "bg-secondary border-border"
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-medium">{s.staff_name}</span>
                              {!s.ended_at && (
                                <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full">
                                  Aktif
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              <span>Giriş: {formatTime(s.started_at)}</span>
                              {s.ended_at && (
                                <>
                                  <span className="mx-1">→</span>
                                  <span>Çıkış: {formatTime(s.ended_at)}</span>
                                  <span className="ml-1 text-foreground/70">
                                    ({formatDuration(s.started_at, s.ended_at)})
                                  </span>
                                </>
                              )}
                            </div>
                            {matchLog && (
                              <div className="mt-1.5 text-xs text-muted-foreground bg-card rounded p-1.5 border border-border">
                                {matchLog.details.split(" | ").slice(1).join(" | ")}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Kapat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ShiftDialog;
