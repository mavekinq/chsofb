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
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Clock, User, LogIn, LogOut } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Shift {
  id: string;
  staff_name: string;
  started_at: string;
  ended_at: string | null;
  created_at: string;
}

interface ShiftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ShiftDialog = ({ open, onOpenChange }: ShiftDialogProps) => {
  const [staffName, setStaffName] = useState("");
  const [loading, setLoading] = useState(false);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loadingShifts, setLoadingShifts] = useState(true);

  const fetchShifts = async () => {
    const { data } = await supabase
      .from("shifts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    if (data) setShifts(data as Shift[]);
    setLoadingShifts(false);
  };

  useEffect(() => {
    if (open) fetchShifts();
  }, [open]);

  const activeShift = shifts.find((s) => !s.ended_at);

  const handleTakeShift = async () => {
    if (!staffName.trim()) {
      toast.error("Lütfen personel adını girin");
      return;
    }
    setLoading(true);
    try {
      // End any active shift first
      if (activeShift) {
        await supabase
          .from("shifts")
          .update({ ended_at: new Date().toISOString() })
          .eq("id", activeShift.id);
      }
      const { error } = await supabase.from("shifts").insert({
        staff_name: staffName.trim(),
        started_at: new Date().toISOString(),
      });
      if (error) throw error;
      toast.success(`Vardiya teslim alındı: ${staffName}`);
      setStaffName("");
      await fetchShifts();
    } catch (e: any) {
      toast.error("Vardiya kaydedilemedi: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleEndShift = async () => {
    if (!activeShift) return;
    setLoading(true);
    try {
      const { error } = await supabase
        .from("shifts")
        .update({ ended_at: new Date().toISOString() })
        .eq("id", activeShift.id);
      if (error) throw error;
      toast.success(`Vardiya devredildi: ${activeShift.staff_name}`);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading">Vardiya Yönetimi</DialogTitle>
        </DialogHeader>

        {/* Active shift info */}
        {activeShift && (
          <div className="bg-primary/10 border border-primary/30 rounded-lg p-3 mb-2">
            <div className="flex items-center gap-2 mb-1">
              <User className="w-4 h-4 text-primary" />
              <span className="font-medium text-sm">Aktif Vardiya</span>
            </div>
            <p className="text-sm font-semibold">{activeShift.staff_name}</p>
            <p className="text-xs text-muted-foreground">
              Başlangıç: {formatTime(activeShift.started_at)}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2 gap-1.5 text-destructive border-destructive/50"
              onClick={handleEndShift}
              disabled={loading}
            >
              <LogOut className="w-4 h-4" />
              Vardiyayı Devret
            </Button>
          </div>
        )}

        {/* Take new shift */}
        <div className="space-y-3 border-t border-border pt-3">
          <Label className="flex items-center gap-1.5">
            <LogIn className="w-4 h-4" />
            Yeni Vardiya Teslim Al
          </Label>
          <Input
            value={staffName}
            onChange={(e) => setStaffName(e.target.value)}
            placeholder="Ad Soyad"
            className="bg-secondary border-border"
          />
          <Button onClick={handleTakeShift} disabled={loading} className="w-full">
            {loading ? "Kaydediliyor..." : "Teslim Al"}
          </Button>
        </div>

        {/* Shift history */}
        <div className="border-t border-border pt-3 mt-2">
          <h3 className="font-heading text-sm font-semibold mb-2 flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-muted-foreground" />
            Vardiya Geçmişi
          </h3>
          <ScrollArea className="max-h-[200px]">
            {loadingShifts ? (
              <p className="text-xs text-muted-foreground text-center py-3">Yükleniyor...</p>
            ) : shifts.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-3">Kayıt yok</p>
            ) : (
              <div className="space-y-2">
                {shifts.map((s) => (
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
