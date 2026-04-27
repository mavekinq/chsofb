import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const NOTE_TEMPLATES = [
  "Tekeri Bozuk",
  "Frenleri Çalışmıyor",
  "Teknikte",
  "Ayaklık Kırık",
  "Emniyet Kemeri Yok",
  "Kullanmaya Uygun Değil",
];

interface NoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialNote: string;
  onConfirm: (note: string) => void;
}

const NoteDialog = ({ open, onOpenChange, initialNote, onConfirm }: NoteDialogProps) => {
  const [note, setNote] = useState(initialNote);

  useEffect(() => {
    if (open) {
      setNote(initialNote);
    }
  }, [open, initialNote]);

  const handleConfirm = () => {
    onConfirm(note.trim());
  };

  const handleTemplateSelect = (template: string) => {
    const trimmedNote = note.trim();
    if (!trimmedNote) {
      setNote(template);
      return;
    }

    const noteParts = trimmedNote
      .split(" • ")
      .map((part) => part.trim())
      .filter(Boolean);

    if (noteParts.includes(template)) {
      return;
    }

    setNote(`${trimmedNote} • ${template}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading">Sandalyeye Not Ekle</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Hazır Notlar</Label>
            <div className="flex flex-wrap gap-2">
              {NOTE_TEMPLATES.map((template) => (
                <Button
                  key={template}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-auto min-h-8 whitespace-normal text-left"
                  onClick={() => handleTemplateSelect(template)}
                >
                  {template}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Not</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Bu sandalye için kısa bir not yazın..."
              className="bg-secondary border-border"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            İptal
          </Button>
          <Button onClick={handleConfirm}>
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default NoteDialog;
