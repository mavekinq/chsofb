import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TERMINALS = ["İç Hat", "T1", "T2", "Diğer"];

interface TransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (terminal: string) => void;
}

const TransferDialog = ({ open, onOpenChange, onConfirm }: TransferDialogProps) => {
  const [terminal, setTerminal] = useState("");

  const handleConfirm = () => {
    if (!terminal) return;
    onConfirm(terminal);
    setTerminal("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border">
        <DialogHeader>
          <DialogTitle className="font-heading">Sandalye Transferi</DialogTitle>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <Label>Hedef Terminal</Label>
          <Select value={terminal} onValueChange={setTerminal}>
            <SelectTrigger className="bg-secondary border-border">
              <SelectValue placeholder="Terminal seçin..." />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              {TERMINALS.map((item) => (
                <SelectItem key={item} value={item}>{item}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>İptal</Button>
          <Button onClick={handleConfirm} disabled={!terminal}>Transfer Et</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TransferDialog;