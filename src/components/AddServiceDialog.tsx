import { useState, useEffect, useRef } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { matchesWheelchairInventoryTerminal } from "@/lib/wheelchair-terminals";
import { toast } from "sonner";
import { Plane, MapPin, Clock, User, Accessibility, AlertCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

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
  plannedPosition?: string;
  parkPosition?: string;
}

interface EditableService {
  id: string;
  wheelchair_id: string;
  passenger_type: "STEP" | "RAMP" | "CABIN";
  notes: string;
  assigned_staff?: string;
}

interface AddServiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  flight: Flight | null;
  terminal: string;
  onConfirm: (flight: Flight, wheelchairId: string, passengerType: string, notes: string, assignedStaff: string) => void;
  onServiceAdded?: () => void;
  formatFlightTime?: (flight: Flight) => string;
  getDisplayGate?: (flight: Flight | null) => string;
  serviceToEdit?: EditableService | null;
}

const PASSENGER_TYPES = [
  {
    value: "STEP" as const,
    label: "STEP",
    subtitle: "Merdiven",
    description: "Uçağa merdivenden biner",
    color: "bg-blue-50 border-blue-300 text-blue-800 data-[selected=true]:bg-blue-100 data-[selected=true]:border-blue-500",
    badgeColor: "bg-blue-100 text-blue-800",
  },
  {
    value: "RAMP" as const,
    label: "RAMP",
    subtitle: "Rampa",
    description: "Körükten ya da rampadan biner",
    color: "bg-green-50 border-green-300 text-green-800 data-[selected=true]:bg-green-100 data-[selected=true]:border-green-500",
    badgeColor: "bg-green-100 text-green-800",
  },
  {
    value: "CABIN" as const,
    label: "CABIN",
    subtitle: "Kabin",
    description: "Kabine kadar yardım gerekir",
    color: "bg-purple-50 border-purple-300 text-purple-800 data-[selected=true]:bg-purple-100 data-[selected=true]:border-purple-500",
    badgeColor: "bg-purple-100 text-purple-800",
  },
] as const;

const AddServiceDialog = ({
  open,
  onOpenChange,
  flight,
  terminal,
  onConfirm,
  onServiceAdded,
  formatFlightTime,
  getDisplayGate,
  serviceToEdit,
}: AddServiceDialogProps) => {
  const [wheelchairId, setWheelchairId] = useState("");
  const [passengerType, setPassengerType] = useState<"STEP" | "RAMP" | "CABIN">("STEP");
  const [notes, setNotes] = useState("");
  const [assignedStaff, setAssignedStaff] = useState("");
  const [availableWheelchairs, setAvailableWheelchairs] = useState<Wheelchair[]>([]);
  const [loading, setLoading] = useState(false);
  const staffInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      fetchAvailableWheelchairs();
      setWheelchairId(serviceToEdit?.wheelchair_id || "");
      setPassengerType(serviceToEdit?.passenger_type || "STEP");
      setNotes(serviceToEdit?.notes || "");
      setAssignedStaff(serviceToEdit?.assigned_staff || localStorage.getItem("userName") || "");
      setTimeout(() => staffInputRef.current?.focus(), 100);
    } else {
      reset();
    }
  }, [open, terminal, serviceToEdit]);

  const fetchAvailableWheelchairs = async () => {
    const { data } = await supabase
      .from("wheelchairs")
      .select("*")
      .eq("status", "available");

    if (data) {
      const filtered = (data as Wheelchair[]).filter((wheelchair) =>
        matchesWheelchairInventoryTerminal(terminal, wheelchair.terminal),
      );
      if (serviceToEdit?.wheelchair_id && !filtered.some((wheelchair) => wheelchair.wheelchair_id === serviceToEdit.wheelchair_id)) {
        filtered.unshift({
          id: `existing-${serviceToEdit.id}`,
          wheelchair_id: serviceToEdit.wheelchair_id,
          status: "assigned",
          terminal,
        });
      }
      setAvailableWheelchairs(filtered);
    }
  };

  const reset = () => {
    setWheelchairId("");
    setPassengerType("STEP");
    setNotes("");
    setAssignedStaff("");
  };

  const handleConfirm = async () => {
    if (!flight || !wheelchairId.trim() || !assignedStaff.trim()) {
      toast.error("Lütfen sandalye ve personel alanlarını doldurun");
      return;
    }

    setLoading(true);
    try {
      await onConfirm(flight, wheelchairId.trim(), passengerType, notes.trim(), assignedStaff.trim());
      onServiceAdded?.();
      reset();
      onOpenChange(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Bilinmeyen hata";
      toast.error("Hizmet eklenemedi: " + message);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    reset();
    onOpenChange(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      void handleConfirm();
    }
  };

  const displayTime = flight && formatFlightTime ? formatFlightTime(flight) : flight?.dep_time || "-";
  const displayGate = flight && getDisplayGate ? getDisplayGate(flight) : "-";
  const selectedType = PASSENGER_TYPES.find((t) => t.value === passengerType);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-md" onKeyDown={handleKeyDown}>
        <DialogHeader className="pb-0">
          <DialogTitle className="font-heading text-xl">{serviceToEdit ? "Hizmeti Düzenle" : "Hizmet Kaydı"}</DialogTitle>
        </DialogHeader>

        {/* Flight Info Banner */}
        {flight && (
          <div className="rounded-xl bg-primary/5 border border-primary/20 px-4 py-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center flex-shrink-0">
              <Plane className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-heading font-bold text-base text-foreground">{flight.flight_iata}</p>
              <p className="text-xs text-muted-foreground">{flight.dep_iata} → {flight.arr_iata}</p>
            </div>
            <div className="text-right flex-shrink-0 space-y-0.5">
              <div className="flex items-center gap-1 justify-end text-xs font-mono font-semibold text-foreground">
                <Clock className="w-3 h-3 text-muted-foreground" />
                {displayTime}
              </div>
              <div className="flex items-center gap-1 justify-end text-xs text-muted-foreground">
                <MapPin className="w-3 h-3" />
                Gate {displayGate}
              </div>
            </div>
          </div>
        )}

        <Separator />

        <div className="space-y-5 py-1">
          {/* Passenger Type Visual Selector */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Yolcu Tipi</Label>
            <div className="grid grid-cols-3 gap-2">
              {PASSENGER_TYPES.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  data-selected={passengerType === type.value}
                  onClick={() => setPassengerType(type.value)}
                  className={cn(
                    "rounded-xl border-2 p-3 text-left transition-all duration-150 cursor-pointer",
                    passengerType === type.value
                      ? cn(type.color, "shadow-sm")
                      : "bg-secondary border-transparent hover:border-border text-foreground",
                  )}
                >
                  <p className="font-heading font-bold text-sm leading-none">{type.label}</p>
                  <p className="text-[11px] mt-1 opacity-70 leading-tight">{type.subtitle}</p>
                </button>
              ))}
            </div>
            {selectedType && (
              <p className="text-xs text-muted-foreground pl-1">{selectedType.description}</p>
            )}
          </div>

          {/* Wheelchair Select */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <Accessibility className="w-3.5 h-3.5 text-muted-foreground" />
                Tekerlekli Sandalye
              </Label>
              {availableWheelchairs.length > 0 ? (
                <span className="text-xs text-primary font-medium">{availableWheelchairs.length} müsait</span>
              ) : (
                <span className="text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  Müsait yok
                </span>
              )}
            </div>
            <Select value={wheelchairId} onValueChange={setWheelchairId}>
              <SelectTrigger className="bg-secondary border-border">
                <SelectValue placeholder="Sandalye seçin..." />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                {availableWheelchairs.length === 0 && (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    Bu terminalde müsait sandalye yok
                  </div>
                )}
                {availableWheelchairs.map((wheelchair) => (
                  <SelectItem key={wheelchair.id} value={wheelchair.wheelchair_id}>
                    {wheelchair.wheelchair_id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Assigned Staff */}
          <div className="space-y-2">
            <Label htmlFor="staff-input" className="text-sm font-medium flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-muted-foreground" />
              Atanan Personel
            </Label>
            <Input
              id="staff-input"
              ref={staffInputRef}
              value={assignedStaff}
              onChange={(e) => setAssignedStaff(e.target.value)}
              placeholder="Personel adını girin..."
              className="bg-secondary border-border"
            />
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-muted-foreground">Ek Notlar <span className="text-xs">(isteğe bağlı)</span></Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Özel notlar, ihtiyaçlar..."
              className="bg-secondary border-border resize-none"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 flex-col sm:flex-row">
          <p className="text-[11px] text-muted-foreground mr-auto hidden sm:block">Ctrl+Enter ile kaydet</p>
          <Button variant="outline" onClick={handleCancel} disabled={loading} className="sm:w-auto w-full">
            İptal
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={loading || !wheelchairId || !assignedStaff.trim()}
            className="sm:w-auto w-full gap-2"
          >
            {loading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Kaydediliyor...
              </>
            ) : (
              serviceToEdit ? "Değişiklikleri Kaydet" : "Hizmet Kaydet"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddServiceDialog;