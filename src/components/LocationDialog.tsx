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

const GATES = [
  "Gate 1", "Gate 2", "Gate 3", "Gate 4", "Gate 5",
  "Gate 6", "Gate 7", "Gate 8", "Gate 9", "Gate 10",
  "Gate 11", "Gate 12", "Gate 13", "Gate 14", "Gate 15",
  "Giriş", "Çıkış", "Bagaj", "Check-in",
];

interface LocationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (gate: string) => void;
}

const LocationDialog = ({ open, onOpenChange, onConfirm }: LocationDialogProps) => {
  const [mode, setMode] = useState<"select" | "manual">("select");
  const [gate, setGate] = useState("");
  const [manualGate, setManualGate] = useState("");

  const handleConfirm = () => {
    const value = mode === "select" ? gate : manualGate.trim();
    if (!value) return;
    onConfirm(value);
    setGate("");
    setManualGate("");
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
              Gate Seç
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
              <Label>Gate</Label>
              <Select value={gate} onValueChange={setGate}>
                <SelectTrigger className="bg-secondary border-border">
                  <SelectValue placeholder="Gate seçin..." />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {GATES.map((g) => (
                    <SelectItem key={g} value={g}>{g}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Konum</Label>
              <Input
                value={manualGate}
                onChange={(e) => setManualGate(e.target.value)}
                placeholder="Konum yazın..."
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
