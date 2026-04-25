import { Accessibility, MapPin, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type WheelchairStatus = "available" | "missing" | "maintenance";

export interface Wheelchair {
  id: string;
  wheelchair_id: string;
  status: WheelchairStatus;
  gate: string;
  terminal: string;
  note?: string;
}

interface WheelchairCardProps {
  wheelchair: Wheelchair;
  onStatusChange: (id: string, status: WheelchairStatus) => void;
  onLocationChange: (id: string) => void;
  onNoteChange: (id: string) => void;
}

const WheelchairCard = ({ wheelchair, onStatusChange, onLocationChange, onNoteChange }: WheelchairCardProps) => {
  return (
    <div className="bg-card border border-border rounded-lg p-4 hover:border-primary/30 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Accessibility className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-heading font-semibold text-sm">{wheelchair.wheelchair_id}</h3>
            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
              <MapPin className="w-3 h-3" />
              <span>{wheelchair.gate || "Atanmamış"}</span>
            </div>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreVertical className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-popover border-border">
            <DropdownMenuItem onClick={() => onStatusChange(wheelchair.id, "available")}>
              ✅ Müsait
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onStatusChange(wheelchair.id, "missing")}>
              🔴 Eksik
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onStatusChange(wheelchair.id, "maintenance")}>
              🟠 Bakımda
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onLocationChange(wheelchair.id)}>
              📍 Konum Değiştir
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onNoteChange(wheelchair.id)}>
              📝 Not Ekle / Düzenle
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {wheelchair.note ? (
        <p className="mt-3 text-sm text-muted-foreground line-clamp-2">
          <span className="font-medium text-foreground">Not:</span> {wheelchair.note}
        </p>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-2 md:hidden">
        <Button
          size="sm"
          variant={wheelchair.status === "available" ? "default" : "outline"}
          className="text-xs"
          onClick={() => onStatusChange(wheelchair.id, "available")}
        >
          ✅ Musait
        </Button>
        <Button
          size="sm"
          variant={wheelchair.status === "missing" ? "default" : "outline"}
          className="text-xs"
          onClick={() => onStatusChange(wheelchair.id, "missing")}
        >
          🔴 Eksik
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-xs"
          onClick={() => onLocationChange(wheelchair.id)}
        >
          📍 Konum Ata
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-xs"
          onClick={() => onNoteChange(wheelchair.id)}
        >
          📝 Not Ekle
        </Button>
      </div>
    </div>
  );
};

export default WheelchairCard;
