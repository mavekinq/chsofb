import { useState } from "react";
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
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Wheelchair } from "@/components/WheelchairCard";

const TERMINALS = ["İç Hat", "T1", "T2"];

interface WheelchairManageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wheelchairs: Wheelchair[];
}

const WheelchairManageDialog = ({ open, onOpenChange, wheelchairs }: WheelchairManageDialogProps) => {
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [wheelchairId, setWheelchairId] = useState("");
  const [terminal, setTerminal] = useState("İç Hat");
  const [gate, setGate] = useState("");
  const [loading, setLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Wheelchair | null>(null);

  const handleAdd = async () => {
    if (!wheelchairId.trim()) {
      toast.error("Sandalye ID girin");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.from("wheelchairs").insert({
        wheelchair_id: wheelchairId.trim(),
        terminal,
        gate: gate.trim() || "",
        status: "available",
      });
      if (error) throw error;
      await supabase.from("action_logs").insert({
        wheelchair_id: wheelchairId.trim(),
        action: "Envantore Eklendi",
        details: `Terminal: ${terminal}${gate ? `, Konum: ${gate}` : ""}`,
        performed_by: "Personel",
      });
      toast.success(`${wheelchairId} envantore eklendi`);
      setWheelchairId("");
      setGate("");
    } catch (e: any) {
      toast.error("Eklenemedi: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setLoading(true);
    try {
      const { error } = await supabase.from("wheelchairs").delete().eq("id", deleteTarget.id);
      if (error) throw error;
      await supabase.from("action_logs").insert({
        wheelchair_id: deleteTarget.wheelchair_id,
        action: "Envanterden Çıkarıldı",
        details: `Terminal: ${deleteTarget.terminal}`,
        performed_by: "Personel",
      });
      toast.success(`${deleteTarget.wheelchair_id} envanterden çıkarıldı`);
      setDeleteTarget(null);
    } catch (e: any) {
      toast.error("Silinemedi: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading">Envanter Yönetimi</DialogTitle>
          </DialogHeader>

          <div className="flex gap-2 mb-4">
            <Button
              variant={mode === "add" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("add")}
              className="gap-1.5"
            >
              <Plus className="w-4 h-4" />
              Ekle
            </Button>
            <Button
              variant={mode === "remove" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("remove")}
              className="gap-1.5"
            >
              <Trash2 className="w-4 h-4" />
              Çıkar
            </Button>
          </div>

          {mode === "add" ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Sandalye ID</Label>
                <Input
                  value={wheelchairId}
                  onChange={(e) => setWheelchairId(e.target.value)}
                  placeholder="Örn: WC-101"
                  className="bg-secondary border-border"
                />
              </div>
              <div className="space-y-2">
                <Label>Terminal</Label>
                <Select value={terminal} onValueChange={setTerminal}>
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
              <div className="space-y-2">
                <Label>Konum (opsiyonel)</Label>
                <Input
                  value={gate}
                  onChange={(e) => setGate(e.target.value)}
                  placeholder="Örn: Gate 5"
                  className="bg-secondary border-border"
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => onOpenChange(false)}>İptal</Button>
                <Button onClick={handleAdd} disabled={loading}>
                  {loading ? "Ekleniyor..." : "Ekle"}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-3">
              {wheelchairs.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-4">Envanterde sandalye yok</p>
              ) : (
                <div className="max-h-[300px] overflow-y-auto space-y-2">
                  {wheelchairs.map((w) => (
                    <div
                      key={w.id}
                      className="flex items-center justify-between p-3 bg-secondary rounded-lg border border-border"
                    >
                      <div>
                        <p className="font-medium text-sm">{w.wheelchair_id}</p>
                        <p className="text-xs text-muted-foreground">{w.terminal} — {w.gate || "Konum yok"}</p>
                      </div>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setDeleteTarget(w)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => onOpenChange(false)}>Kapat</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>Sandalyeyi Çıkar</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.wheelchair_id}</strong> envanterden çıkarılacak. Bu işlem geri alınamaz.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İptal</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={loading}>
              {loading ? "Siliniyor..." : "Çıkar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default WheelchairManageDialog;
