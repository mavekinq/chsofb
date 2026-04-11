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
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ShiftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ShiftDialog = ({ open, onOpenChange }: ShiftDialogProps) => {
  const [staffName, setStaffName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!staffName.trim()) {
      toast.error("Lütfen personel adını girin");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.from("shifts").insert({
        staff_name: staffName.trim(),
        started_at: new Date().toISOString(),
      });
      if (error) throw error;
      toast.success(`Vardiya teslim alındı: ${staffName}`);
      setStaffName("");
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Vardiya kaydedilemedi: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border">
        <DialogHeader>
          <DialogTitle className="font-heading">Vardiya Teslim Al</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Personel Adı</Label>
            <Input
              value={staffName}
              onChange={(e) => setStaffName(e.target.value)}
              placeholder="Ad Soyad"
              className="bg-secondary border-border"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            İptal
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? "Kaydediliyor..." : "Teslim Al"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ShiftDialog;
