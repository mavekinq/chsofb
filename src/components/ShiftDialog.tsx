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
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Clock, User, LogIn, LogOut, Building2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TERMINALS = ["İç Hat", "Dış Hat"];

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
}

const ShiftDialog = ({ open, onOpenChange }: ShiftDialogProps) => {
  const [staffName, setStaffName] = useState("");
  const [selectedTerminal, setSelectedTerminal] = useState("İç Hat");
  const [loading, setLoading] = useState(false);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loadingShifts, setLoadingShifts] = useState(true);
  const [activeTerminalTab, setActiveTerminalTab] = useState("İç Hat");

  const fetchShifts = async () => {
    const { data } = await supabase
      .from("shifts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30);
    if (data) setShifts(data as Shift[]);
    setLoadingShifts(false);
  };

  useEffect(() => {
    if (open) fetchShifts();
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

  const handleEndShift = async (terminal: string) => {
    const active = getActiveShift(terminal);
    if (!active) return;
    setLoading(true);
    try {
      const { error } = await supabase
        .from("shifts")
        .update({ ended_at: new Date().toISOString() })
        .eq("id", active.id);
      if (error) throw error;
      toast.success(`${terminal} vardiyası devredildi: ${active.staff_name}`);
      await fetchShifts();
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
      <DialogContent className="bg-card border-border max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading">Vardiya Yönetimi</DialogTitle>
        </DialogHeader>

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
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2 gap-1 text-xs text-destructive border-destructive/50 w-full"
                      onClick={() => handleEndShift(t)}
                      disabled={loading}
                    >
                      <LogOut className="w-3 h-3" />
                      Devret
                    </Button>
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
                <ScrollArea className="max-h-[180px]">
                  {loadingShifts ? (
                    <p className="text-xs text-muted-foreground text-center py-3">Yükleniyor...</p>
                  ) : terminalShifts(t).length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-3">Kayıt yok</p>
                  ) : (
                    <div className="space-y-2">
                      {terminalShifts(t).map((s) => (
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
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
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
