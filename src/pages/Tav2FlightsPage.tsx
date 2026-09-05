import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Plane, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";

type TavFlight = {
  flightNo: string;
  date: string;
  airline: string;
  city: string;
  scheduled: string;
  estimated: string;
  counter: string;
  terminal: string;
  status: string;
};

const SOURCE_URL = "https://www.antalya-airport.aero/yolcu-ve-ziyaretciler/ucus-bilgileri/yurtici-gidis";
const SOURCE_PROXY_URL = "https://r.jina.ai/https://www.antalya-airport.aero/yolcu-ve-ziyaretciler/ucus-bilgileri/yurtici-gidis";

type FetchTavFlightsFunctionResult = {
  success: boolean;
  rowCount?: number;
  html?: string;
  source?: string;
  error?: string;
};

const fixMojibake = (value: string) => {
  if (!value || (!value.includes("Ã") && !value.includes("Ä") && !value.includes("Å") && !value.includes("Ä°"))) {
    return value;
  }

  try {
    const bytes = Uint8Array.from(Array.from(value).map((char) => char.charCodeAt(0) & 0xff));
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return value;
  }
};

const cleanText = (value: string) =>
  fixMojibake(String(value || "").replace(/\s+/g, " ").trim());

const parseHtmlFlights = (html: string): TavFlight[] => {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const rows = Array.from(doc.querySelectorAll("#ContentPlaceHolder_ForNested_ContentPlaceHolder_ForNested_div_list tbody tr"));

  return rows
    .map((row) => {
      const flightNo = cleanText(row.querySelector("td.flightnum span")?.textContent || "");
      const date = cleanText(row.querySelector("td.date span")?.textContent || "");
      const airline = cleanText(row.querySelector("td.airline .icongroup span")?.textContent || "");
      const city = cleanText(row.querySelector("td.from span")?.textContent || "");
      const scheduled = cleanText(row.querySelector("td.time.scheduled span")?.textContent || "");
      const estimated = cleanText(row.querySelector("td.time.estimated span")?.textContent || "");
      const counter = cleanText(row.querySelector("td.belt span")?.textContent || "");
      const terminal = cleanText(row.querySelector("td.terminal span")?.textContent || "");
      const status = cleanText(row.querySelector("td.status span")?.textContent || "");

      return {
        flightNo,
        date,
        airline,
        city,
        scheduled,
        estimated,
        counter,
        terminal,
        status,
      } satisfies TavFlight;
    })
    .filter((item) => item.flightNo.length > 0);
};

const parseProxyMarkdownFlights = (content: string): TavFlight[] => {
  const lines = content.split(/\r?\n/).map((line) => line.trim());
  const rows = lines.filter((line) => line.startsWith("|") && line.endsWith("|"));

  return rows
    .map((line) => {
      const cols = line.split("|").slice(1, -1).map((col) => cleanText(col));
      if (cols.length < 11) return null;
      if (cols[0].toLowerCase().includes("uçuş") || cols[0].toLowerCase().includes("uçuş") || cols[0].includes("---")) return null;

      return {
        flightNo: cols[1] || "",
        date: cols[2] || "",
        airline: cols[3] || "",
        city: cols[4] || "",
        scheduled: cols[6] || cols[5] || "",
        estimated: cols[7] || "",
        counter: cols[8] || "",
        terminal: cols[9] || "",
        status: cols[10] || "",
      } satisfies TavFlight;
    })
    .filter((item): item is TavFlight => Boolean(item?.flightNo));
};

const parseFlightsFromContent = (content: string) => {
  const htmlParsed = parseHtmlFlights(content);
  if (htmlParsed.length > 0) {
    return htmlParsed;
  }

  return parseProxyMarkdownFlights(content);
};

const isPcFlight = (flightNo: string) => {
  const normalized = String(flightNo || "").trim().toUpperCase();
  return normalized.startsWith("PC/") || normalized.startsWith("PC ") || normalized.startsWith("PC");
};

const Tav2FlightsPage = () => {
  const navigate = useNavigate();
  const [allFlights, setAllFlights] = useState<TavFlight[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [sourceInfo, setSourceInfo] = useState("");

  const fetchFlights = async (silent = false) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError("");
    setSourceInfo("");

    try {
      const { data, error: functionError } = await supabase.functions.invoke("fetch-tav-flights", {
        body: { mode: "all", source: "domestic" },
      });

      if (!functionError) {
        const result = (data || { success: false, error: "Bilinmeyen yanit" }) as FetchTavFlightsFunctionResult;
        if (result.success && result.html) {
          const functionFlights = parseFlightsFromContent(result.html);
          if (functionFlights.length > 0) {
            const pcFlights = functionFlights.filter((item) => isPcFlight(item.flightNo));
            setAllFlights(pcFlights);
            setLastUpdated(new Date());
            setSourceInfo(`Tam liste: ${pcFlights.length} PC uçuş (${result.source || "edge"})`);
            return;
          }
        }
      }

      const directResponse = await fetch(SOURCE_URL);
      if (!directResponse.ok) throw new Error(`Source request failed: ${directResponse.status}`);
      const directContent = await directResponse.text();
      const directFlights = parseFlightsFromContent(directContent);

      if (directFlights.length > 0) {
        const pcFlights = directFlights.filter((item) => isPcFlight(item.flightNo));
        setAllFlights(pcFlights);
        setLastUpdated(new Date());
        setSourceInfo(`Direkt kaynak: ${pcFlights.length} PC uçuş`);
        return;
      }
      throw new Error("No flights in direct response");
    } catch {
      try {
        const proxyResponse = await fetch(SOURCE_PROXY_URL);
        if (!proxyResponse.ok) throw new Error(`Proxy request failed: ${proxyResponse.status}`);
        const proxyContent = await proxyResponse.text();
        const proxyFlights = parseFlightsFromContent(proxyContent);

        if (proxyFlights.length === 0) {
          throw new Error("No flights in proxy response");
        }

        const pcFlights = proxyFlights.filter((item) => isPcFlight(item.flightNo));
        setAllFlights(pcFlights);
        setLastUpdated(new Date());
        setSourceInfo(`Proxy kaynak: ${pcFlights.length} PC uçuş (ilk bölüm)`);
      } catch (proxyError) {
        console.error("TAV2 flights fetch failed:", proxyError);
        setError("TAV iç hat uçuş verileri alınamadı.");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    const user = localStorage.getItem("userName");
    if (!user) {
      navigate("/login");
      return;
    }

    void fetchFlights();
    const timer = window.setInterval(() => {
      void fetchFlights(true);
    }, 60000);

    return () => window.clearInterval(timer);
  }, [navigate]);

  const filteredFlights = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("tr-TR");
    if (!query) return allFlights;

    return allFlights.filter((flight) =>
      [flight.flightNo, flight.city, flight.airline, flight.status, flight.counter, flight.terminal]
        .join(" ")
        .toLocaleLowerCase("tr-TR")
        .includes(query),
    );
  }, [allFlights, search]);

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
            <h1 className="font-heading font-bold text-lg">TAV İç Hat Gidiş</h1>
          </div>

          <Button variant="outline" size="sm" onClick={() => fetchFlights(true)} disabled={refreshing} className="gap-1.5">
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            Yenile
          </Button>
        </div>
      </header>

      <main className="container px-4 py-6 space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative max-w-md flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Uçuş, şehir, havayolu, durum ara..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-9 bg-secondary border-border"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {filteredFlights.length} uçuş • {lastUpdated ? lastUpdated.toLocaleTimeString("tr-TR") : "-"}
          </p>
        </div>
        {sourceInfo ? <p className="text-xs text-muted-foreground">{sourceInfo}</p> : null}

        {loading ? (
          <div className="text-center py-14 text-muted-foreground">Uçuş verileri yükleniyor...</div>
        ) : error ? (
          <div className="text-center py-14 text-muted-foreground">{error}</div>
        ) : filteredFlights.length === 0 ? (
          <div className="text-center py-14 text-muted-foreground">Listelenecek uçuş bulunamadı.</div>
        ) : (
          <ScrollArea className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary/50">
                  <TableHead>Uçuş</TableHead>
                  <TableHead>Tarih</TableHead>
                  <TableHead>Havayolu</TableHead>
                  <TableHead>Şehir</TableHead>
                  <TableHead>Saat</TableHead>
                  <TableHead>Tahmini</TableHead>
                  <TableHead>Kontuar</TableHead>
                  <TableHead>Terminal</TableHead>
                  <TableHead>Durum</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredFlights.map((flight) => (
                  <TableRow key={`${flight.flightNo}-${flight.date}-${flight.scheduled}-${flight.counter}`}>
                    <TableCell className="font-medium">{flight.flightNo || "-"}</TableCell>
                    <TableCell>{flight.date || "-"}</TableCell>
                    <TableCell>{flight.airline || "-"}</TableCell>
                    <TableCell>{flight.city || "-"}</TableCell>
                    <TableCell>{flight.scheduled || "-"}</TableCell>
                    <TableCell>{flight.estimated || "-"}</TableCell>
                    <TableCell>{flight.counter || "-"}</TableCell>
                    <TableCell>{flight.terminal || "-"}</TableCell>
                    <TableCell>{flight.status || "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </main>
    </div>
  );
};

export default Tav2FlightsPage;
