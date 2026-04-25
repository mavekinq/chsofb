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

const LOCATIONS = [
  "İç Hat Merdiven Altı",
  "İç Hat Gate",
  "İç Hat Arrival",
  "T2 Ofis",
  "T2 Gate",
  "T2 Arrival",
  "Ambulift",
  "Merkez",
];

interface LocationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (location: string) => void;
}

const LocationDialog = ({ open, onOpenChange, onConfirm }: LocationDialogProps) => {
  const [mode, setMode] = useState<"select" | "manual">("select");
  const [selectedLocation, setSelectedLocation] = useState("");
  const [manualLocation, setManualLocation] = useState("");

  const handleConfirm = () => {
    const value = mode === "select" ? selectedLocation : manualLocation.trim();
    if (!value) return;
    onConfirm(value);
    setSelectedLocation("");
    setManualLocation("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border">
        <DialogHeader>
          <DialogTitle className="font-heading">Konum Değiştir</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex gap-2">
            <Button
              variant={mode === "select" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("select")}
            >
              Lokasyon Seç
            </Button>
            <Button
              variant={mode === "manual" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("manual")}
            >
              Manuel Giriş
            </Button>
          </div>

          {mode === "select" ? (
            <div className="space-y-2">
              <Label>Lokasyon</Label>
              <Select value={selectedLocation} onValueChange={setSelectedLocation}>
                <SelectTrigger className="bg-secondary border-border">
                  <SelectValue placeholder="Lokasyon seçin..." />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {LOCATIONS.map((location) => (
                    <SelectItem key={location} value={location}>{location}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Konum</Label>
              <Input
                value={manualLocation}
                onChange={(e) => setManualLocation(e.target.value)}
                placeholder="Lokasyon yazın..."
                className="bg-secondary border-border"
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>İptal</Button>
          <Button onClick={handleConfirm}>Onayla</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default LocationDialog;
