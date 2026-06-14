import { useEffect, useState } from "react";
import { Search, Plane, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Flight {
  [key: string]: string;
}

interface FlightSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const FlightSidebar = ({ isOpen, onClose }: FlightSidebarProps) => {
  const [flights, setFlights] = useState<Flight[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchFlights = async () => {
      try {
        const res = await fetch(
          "https://docs.google.com/spreadsheets/d/1-UVsf1_jZ_n_CPGqieMMWgMpbVnzzchuvexrseNUSqg/export?format=csv"
        );
        const text = await res.text();
        const lines = text.split("\n").filter(Boolean);
        if (lines.length < 2) return;
        const headers = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""));
        const data = lines.slice(1).map((line) => {
          const values = line.split(",").map((v) => v.trim().replace(/"/g, ""));
          const obj: Flight = {};
          headers.forEach((h, i) => {
            obj[h] = values[i] || "";
          });
          return obj;
        });
        setFlights(data);
      } catch (e) {
        console.error("Flight data fetch failed:", e);
      } finally {
        setLoading(false);
      }
    };
    if (isOpen) fetchFlights();
  }, [isOpen]);

  const filtered = flights.filter((f) =>
    Object.values(f).some((v) => v.toLowerCase().includes(search.toLowerCase()))
  );

  const headers = flights.length > 0 ? Object.keys(flights[0]) : [];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-lg bg-card border-l border-border shadow-2xl flex flex-col animate-fade-in">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Plane className="w-5 h-5 text-primary" />
            <h2 className="font-heading font-semibold text-lg">Günlük Uçuş Planı</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="p-4 border-b border-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Uçuş ara..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-secondary border-border"
            />
          </div>
        </div>

        <ScrollArea className="flex-1">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">Yükleniyor...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">Uçuş bulunamadı</div>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map((flight, i) => (
                <div key={i} className="p-3 hover:bg-accent/50 transition-colors">
                  <div className="grid grid-cols-2 gap-1 text-sm">
                    {headers.map((h) => (
                      <div key={h}>
                        <span className="text-muted-foreground text-xs">{h}</span>
                        <p className="font-medium truncate">{flight[h]}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
};

export default FlightSidebar;
