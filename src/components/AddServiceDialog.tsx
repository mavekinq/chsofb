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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { matchesWheelchairInventoryTerminal } from "@/lib/wheelchair-terminals";
import { toast } from "sonner";

interface Wheelchair {
  id: string;
  wheelchair_id: string;
  status: string;
  terminal: string;
}

interface Flight {
  airline_iata: string;
  flight_iata: string;
  flight_number: string;
  dep_iata: string;
  dep_terminal: string;
  dep_gate: string;
  dep_time: string;
  dep_time_ts: number;
  arr_iata: string;
  status: string;
}

interface AddServiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  flight: Flight | null;
  terminal: string;
  onConfirm: (flight: Flight, wheelchairId: string, passengerType: string, notes: string, assignedStaff: string) => void;
  onServiceAdded?: () => void;
}

const AddServiceDialog = ({ open, onOpenChange, flight, terminal, onConfirm, onServiceAdded }: AddServiceDialogProps) => {
  const [wheelchairId, setWheelchairId] = useState("");
  const [passengerType, setPassengerType] = useState<"STEP" | "RAMP" | "CABIN">("STEP");
  const [notes, setNotes] = useState("");
  const [assignedStaff, setAssignedStaff] = useState("");
  const [availableWheelchairs, setAvailableWheelchairs] = useState<Wheelchair[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      fetchAvailableWheelchairs();
      setAssignedStaff(localStorage.getItem("userName") || "");
    }
  }, [open, terminal]);

  const fetchAvailableWheelchairs = async () => {
    const { data } = await supabase
      .from("wheelchairs")
      .select("*")
      .eq("status", "available");

    if (data) {
      setAvailableWheelchairs(
        (data as Wheelchair[]).filter((wheelchair) =>
          matchesWheelchairInventoryTerminal(terminal, wheelchair.terminal),
        ),
      );
    }
  };

  const handleConfirm = async () => {
    if (!flight || !wheelchairId.trim() || !assignedStaff.trim()) {
      toast.error("Lütfen gerekli alanları doldurun");
      return;
    }

    setLoading(true);
    try {
      await onConfirm(flight, wheelchairId.trim(), passengerType, notes.trim(), assignedStaff.trim());
      onServiceAdded?.();
      setWheelchairId("");
      setPassengerType("STEP");
      setNotes("");
      setAssignedStaff("");
      onOpenChange(false);
    } catch (error) {
      // Error handled in parent
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setWheelchairId("");
    setPassengerType("STEP");
    setNotes("");
    setAssignedStaff("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading">
            Hizmet Ekle - {flight?.flight_iata}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Tekerlekli Sandalye</Label>
            <Select value={wheelchairId} onValueChange={setWheelchairId}>
              <SelectTrigger className="bg-secondary border-border">
                <SelectValue placeholder="Sandalye seçin..." />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                {availableWheelchairs.map((wheelchair) => (
                  <SelectItem key={wheelchair.id} value={wheelchair.wheelchair_id}>
                    {wheelchair.wheelchair_id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Atanan Personel</Label>
            <Input
              value={assignedStaff}
              onChange={(e) => setAssignedStaff(e.target.value)}
              placeholder="Personel adını girin..."
              className="bg-secondary border-border"
            />
          </div>

          <div className="space-y-2">
            <Label>Yolcu Tipi</Label>
            <Select value={passengerType} onValueChange={(value: "STEP" | "RAMP" | "CABIN") => setPassengerType(value)}>
              <SelectTrigger className="bg-secondary border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                <SelectItem value="STEP">STEP - Merdiven</SelectItem>
                <SelectItem value="RAMP">RAMP - Rampa</SelectItem>
                <SelectItem value="CABIN">CABIN - Kabin</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Ek Notlar</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Özel notlar..."
              className="bg-secondary border-border"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={loading}>
            İptal
          </Button>
          <Button onClick={handleConfirm} disabled={loading}>
            {loading ? "Ekleniyor..." : "Hizmet Ekle"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddServiceDialog;