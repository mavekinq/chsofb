import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Plane, ArrowLeft, Clock, MapPin, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fetchFlightPlanEntries, type FlightPlanEntry } from "@/lib/flight-plan";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const FlightsPage = () => {
  const navigate = useNavigate();
  const [flights, setFlights] = useState<FlightPlanEntry[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchFlights = async () => {
      try {
        const data = await fetchFlightPlanEntries();
        setFlights(data);
      } catch (e) {
        console.error("Flight data fetch failed:", e);
      } finally {
        setLoading(false);
      }
    };
    fetchFlights();
    const interval = window.setInterval(() => { void fetchFlights(); }, 60000);
    return () => window.clearInterval(interval);
  }, []);

  const filtered = flights.filter((f) =>
    Object.values(f).some((v) => v.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-30">
        <div className="container flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <Plane className="w-4 h-4 text-primary" />
            </div>
            <h1 className="font-heading font-bold text-lg">Günlük Uçuş Planı</h1>
          </div>
          <p className="text-xs text-muted-foreground hidden sm:block">
            {filtered.length} uçuş listeleniyor
          </p>
        </div>
      </header>

      <main className="container px-4 py-6">
        <div className="relative mb-6 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Uçuş kodu, kuyruk no, park pozisyonu ara..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-secondary border-border"
          />
        </div>

        {loading ? (
          <div className="text-center py-16 text-muted-foreground">Uçuş verileri yükleniyor...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Plane className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>Uçuş bulunamadı</p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block">
              <ScrollArea className="rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-secondary/50">
                      <TableHead className="font-heading">Geliş Kodu</TableHead>
                      <TableHead className="font-heading">Gidiş Kodu</TableHead>
                      <TableHead className="font-heading">Tip</TableHead>
                      <TableHead className="font-heading">Kuyruk No</TableHead>
                      <TableHead className="font-heading">Geliş Saati</TableHead>
                      <TableHead className="font-heading">Gidiş Saati</TableHead>
                      <TableHead className="font-heading">Geliş</TableHead>
                      <TableHead className="font-heading">Gidiş</TableHead>
                      <TableHead className="font-heading">Park Poz.</TableHead>
                      <TableHead className="font-heading">Özel Durum</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((f, i) => (
                      <TableRow key={i} className="hover:bg-accent/30 transition-colors">
                        <TableCell className="font-medium">{f.arrivalCode || "—"}</TableCell>
                        <TableCell className="font-medium">{f.departureCode || "—"}</TableCell>
                        <TableCell>{f.aircraftType || "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{f.tailNumber || "—"}</TableCell>
                        <TableCell>
                          {f.arrivalTime ? (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3 text-muted-foreground" />
                              {f.arrivalTime}
                            </span>
                          ) : "—"}
                        </TableCell>
                        <TableCell>
                          {f.departureTime ? (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3 text-muted-foreground" />
                              {f.departureTime}
                            </span>
                          ) : "—"}
                        </TableCell>
                        <TableCell>{f.arrivalIATA || "—"}</TableCell>
                        <TableCell>{f.departureIATA || "—"}</TableCell>
                        <TableCell>
                          {f.parkPosition ? (
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3 h-3 text-primary" />
                              {f.parkPosition}
                            </span>
                          ) : "—"}
                        </TableCell>
                        <TableCell>
                          {f.specialNotes ? (
                            <span className="flex items-center gap-1 text-status-missing">
                              <AlertTriangle className="w-3 h-3" />
                              {f.specialNotes}
                            </span>
                          ) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-3">
              {filtered.map((f, i) => (
                <div key={i} className="bg-card border border-border rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Plane className="w-4 h-4 text-primary" />
                      <span className="font-heading font-semibold">
                        {f.arrivalCode || "—"} → {f.departureCode || "—"}
                      </span>
                    </div>
                    {f.specialNotes && (
                      <span className="text-xs bg-status-missing/20 text-status-missing px-2 py-0.5 rounded-full flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        {f.specialNotes}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Tip / Kuyruk</p>
                      <p className="font-medium">{f.aircraftType || "—"} · <span className="font-mono">{f.tailNumber || "—"}</span></p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Park Pozisyonu</p>
                      <p className="font-medium flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-primary" />
                        {f.parkPosition || "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Geliş</p>
                      <p className="font-medium">{f.arrivalTime || "—"} ({f.arrivalIATA || "—"})</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Gidiş</p>
                      <p className="font-medium">{f.departureTime || "—"} ({f.departureIATA || "—"})</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
};

export default FlightsPage;
