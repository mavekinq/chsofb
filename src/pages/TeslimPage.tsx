import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Check, ClipboardCheck, Loader2, MapPin, Plane, ScanLine, Upload, UserRound } from "lucide-react";
import { toast } from "sonner";
import { createWorker, PSM } from "tesseract.js";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { fetchFlightPlanEntriesMerged, getFlightCodeMatchKeys, normalizeFlightCode, type FlightPlanEntry } from "@/lib/flight-plan";
import { hasTeslimAccess } from "@/lib/teslim-access";

type DeliveryStage = "ready" | "gate" | "boarding";
type DeliveryRecord = {
  id: string;
  passengerName: string;
  flightCode: string;
  pnr: string;
  seat: string;
  destination: string;
  passengerType: "STEP" | "RAMP" | "CABIN";
  flight: FlightPlanEntry | null;
  stage: DeliveryStage;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
};

const STORAGE_KEY = "teslim-records";
const stageLabels: Record<DeliveryStage, string> = {
  ready: "Hazırlandı",
  gate: "Gate'e bırakıldı",
  boarding: "Boarding",
};

const readRecords = (): DeliveryRecord[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as DeliveryRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const extractValue = (text: string, labels: string[]) => {
  const labelPattern = labels.join("|");
  const match = text.match(new RegExp(`(?:${labelPattern})\\s*[:#-]?\\s*([^\\n|;,]+)`, "iu"));
  return match?.[1]?.trim() || "";
};

const parseTicket = (rawText: string) => {
  const flightMatch = rawText.toUpperCase().match(/\b(?:[A-Z]{2}|[A-Z]\d|\d[A-Z])\s?\d{2,4}\b/);
  const pnrMatch = rawText.toUpperCase().match(/\b(?:PNR|BOOKING|RESERVATION)\s*[:#-]?\s*([A-Z0-9]{5,8})\b/);
  return {
    passengerName: extractValue(rawText, ["name", "passenger", "yolcu", "ad soyad"]),
    flightCode: flightMatch?.[0]?.replace(/\s/g, "") || extractValue(rawText, ["flight", "uçuş"]),
    pnr: pnrMatch?.[1] || extractValue(rawText, ["pnr", "booking", "rezervasyon"]),
    seat: extractValue(rawText, ["seat", "koltuk"]),
    destination: extractValue(rawText, ["destination", "varış", "arrival"]),
  };
};

const prepareTicketImage = (file: File): Promise<HTMLCanvasElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(2.5, Math.max(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight)));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.naturalWidth * scale);
      canvas.height = Math.round(image.naturalHeight * scale);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        reject(new Error("Görsel işleme alanı oluşturulamadı"));
        return;
      }

      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let index = 0; index < imageData.data.length; index += 4) {
        const luminance =
          imageData.data[index] * 0.299 +
          imageData.data[index + 1] * 0.587 +
          imageData.data[index + 2] * 0.114;
        const contrast = Math.max(0, Math.min(255, (luminance - 128) * 1.35 + 128));
        imageData.data[index] = contrast;
        imageData.data[index + 1] = contrast;
        imageData.data[index + 2] = contrast;
      }
      context.putImageData(imageData, 0, 0);
      resolve(canvas);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Görsel yüklenemedi"));
    };
    image.src = objectUrl;
  });

const readTicketBarcode = (image: HTMLCanvasElement) => {
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.PDF_417,
    BarcodeFormat.AZTEC,
    BarcodeFormat.DATA_MATRIX,
  ]);
  hints.set(DecodeHintType.TRY_HARDER, true);

  try {
    const reader = new BrowserMultiFormatReader(hints);
    const result = reader.decodeFromCanvas(image);
    return `${result.getBarcodeFormat()}: ${result.getText()}`;
  } catch {
    return "";
  }
};

const TeslimPage = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [currentUser, setCurrentUser] = useState("");
  const [ticketText, setTicketText] = useState("");
  const [passengerName, setPassengerName] = useState("");
  const [flightCode, setFlightCode] = useState("");
  const [pnr, setPnr] = useState("");
  const [seat, setSeat] = useState("");
  const [destination, setDestination] = useState("");
  const [passengerType, setPassengerType] = useState<DeliveryRecord["passengerType"]>("STEP");
  const [matchedFlight, setMatchedFlight] = useState<FlightPlanEntry | null>(null);
  const [flights, setFlights] = useState<FlightPlanEntry[]>([]);
  const [records, setRecords] = useState<DeliveryRecord[]>(readRecords);
  const [loading, setLoading] = useState(false);
  const [readingFile, setReadingFile] = useState(false);

  useEffect(() => {
    const role = localStorage.getItem("userRole");
    const securityNumber = localStorage.getItem("securityNumber");
    const user = localStorage.getItem("userName") || "";
    if (!user || !hasTeslimAccess(securityNumber, role)) {
      navigate("/login", { replace: true });
      return;
    }
    setCurrentUser(user);
    void fetchFlightPlanEntriesMerged().then(setFlights).catch((error) => {
      console.error("Teslim flight plan fetch failed:", error);
      toast.error("Uçuş planı alınamadı; eşleştirme daha sonra tekrar denenebilir.");
    });
  }, [navigate]);

  const saveRecords = (nextRecords: DeliveryRecord[]) => {
    setRecords(nextRecords);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextRecords));
  };

  const applyTicketData = (text: string) => {
    setTicketText(text);
    const parsed = parseTicket(text);
    setPassengerName(parsed.passengerName);
    setFlightCode(parsed.flightCode);
    setPnr(parsed.pnr);
    setSeat(parsed.seat);
    setDestination(parsed.destination);
    if (parsed.flightCode) {
      const keys = new Set(getFlightCodeMatchKeys(parsed.flightCode));
      setMatchedFlight(
        flights.find((flight) => [flight.arrivalCode, flight.departureCode].some((code) =>
          getFlightCodeMatchKeys(code).some((key) => keys.has(key)),
        )) || null,
      );
    }
  };

  const handleFile = async (file: File) => {
    setReadingFile(true);
    try {
      if (file.type.startsWith("image/")) {
        toast.info("Bilet okunuyor; ilk kullanımda OCR dili indirilebilir.");
        const preparedImage = await prepareTicketImage(file);
        const barcodeText = readTicketBarcode(preparedImage);
        const worker = await createWorker("tur+eng");
        try {
          await worker.setParameters({
            tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
            preserve_interword_spaces: "1",
            user_defined_dpi: "300",
          });
          const result = await worker.recognize(preparedImage, { rotateAuto: true });
          const extractedText = [barcodeText, result.data.text].filter(Boolean).join("\n");
          applyTicketData(extractedText);
          toast.success(
            barcodeText
              ? "Bilet metni ve 2D kodu okundu. Bilgileri kontrol edip uçuşu eşleştirin."
              : "Görsel bilet okundu. Bilgileri kontrol edip uçuşu eşleştirin.",
          );
        } finally {
          await worker.terminate();
        }
        return;
      }
      if (!file.type.includes("text") && !/\.(txt|csv)$/i.test(file.name)) {
        toast.error("Şimdilik görsel, TXT veya CSV bilet yükleyebilirsiniz.");
        return;
      }
      applyTicketData(await file.text());
      toast.success("Bilet metni okundu.");
    } catch (error) {
      console.error("Ticket file read failed:", error);
      toast.error("Bilet dosyası okunamadı.");
    } finally {
      setReadingFile(false);
    }
  };

  const handleMatch = async () => {
    setLoading(true);
    try {
      const latestFlights = flights.length > 0 ? flights : await fetchFlightPlanEntriesMerged();
      setFlights(latestFlights);
      const keys = new Set(getFlightCodeMatchKeys(flightCode));
      const match = latestFlights.find((flight) =>
        [flight.arrivalCode, flight.departureCode].some((code) =>
          getFlightCodeMatchKeys(code).some((key) => keys.has(key)),
        ),
      ) || null;
      setMatchedFlight(match);
      if (match) {
        setDestination(destination || match.departureIATA || match.arrivalIATA);
        toast.success(`${normalizeFlightCode(flightCode)} uçuşu eşleştirildi.`);
      } else {
        toast.warning("Uçuş planında eşleşen kayıt bulunamadı.");
      }
    } catch (error) {
      console.error("Teslim flight matching failed:", error);
      toast.error("Uçuş eşleştirme başarısız.");
    } finally {
      setLoading(false);
    }
  };

  const createRecord = () => {
    if (!passengerName.trim() || !flightCode.trim() || !matchedFlight) {
      toast.error("Yolcu adı, uçuş kodu ve eşleşen uçuş gerekli.");
      return;
    }
    const now = new Date().toISOString();
    const record: DeliveryRecord = {
      id: crypto.randomUUID(),
      passengerName: passengerName.trim(),
      flightCode: normalizeFlightCode(flightCode),
      pnr: pnr.trim(),
      seat: seat.trim(),
      destination: destination.trim() || matchedFlight.departureIATA || matchedFlight.arrivalIATA,
      passengerType,
      flight: matchedFlight,
      stage: "ready",
      createdAt: now,
      updatedAt: now,
      updatedBy: currentUser,
    };
    saveRecords([record, ...records]);
    setPassengerName("");
    setFlightCode("");
    setPnr("");
    setSeat("");
    setDestination("");
    setTicketText("");
    setMatchedFlight(null);
    toast.success("Teslim kaydı oluşturuldu.");
  };

  const updateStage = (recordId: string, stage: DeliveryStage) => {
    const now = new Date().toISOString();
    saveRecords(records.map((record) => record.id === recordId ? { ...record, stage, updatedAt: now, updatedBy: currentUser } : record));
  };

  const activeRecords = useMemo(() => records.slice(0, 12), [records]);

  if (!currentUser) return null;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-card/80 backdrop-blur">
        <div className="container flex h-14 items-center gap-3 px-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}><ArrowLeft className="h-4 w-4" /></Button>
          <div>
            <h1 className="font-heading text-lg font-semibold">Teslim Operasyonu</h1>
            <p className="text-xs text-muted-foreground">WCH yolcu teslim ve boarding takibi</p>
          </div>
          <Badge className="ml-auto border-emerald-500/30 bg-emerald-500/10 text-emerald-300">Yetkili alan</Badge>
        </div>
      </header>

      <main className="container grid gap-5 px-4 py-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ScanLine className="h-5 w-5 text-primary" />Bilet bilgilerini al</CardTitle>
            <CardDescription>Bilet metnini yapıştırın veya PDF/metin dosyası yükleyin. Alanlar otomatik doldurulur.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea value={ticketText} onChange={(event) => applyTicketData(event.target.value)} placeholder={"Örnek:\nPassenger: AYŞE YILMAZ\nFlight: PC1234\nPNR: ABC123\nSeat: 12A"} className="min-h-32" />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={readingFile}>
                {readingFile ? <Loader2 className="animate-spin" /> : <Upload />} Dosyadan oku
              </Button>
              <input ref={fileInputRef} type="file" accept=".txt,.csv,.pdf,image/*" className="hidden" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleFile(file);
                event.currentTarget.value = "";
              }} />
              <Button onClick={() => void handleMatch()} disabled={loading || !flightCode.trim()}>{loading ? <Loader2 className="animate-spin" /> : <Plane />} Uçuşu eşleştir</Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label>Yolcu adı</Label><Input value={passengerName} onChange={(event) => setPassengerName(event.target.value)} /></div>
              <div><Label>Uçuş kodu</Label><Input value={flightCode} onChange={(event) => setFlightCode(event.target.value.toUpperCase())} placeholder="PC1234" /></div>
              <div><Label>PNR</Label><Input value={pnr} onChange={(event) => setPnr(event.target.value.toUpperCase())} /></div>
              <div><Label>Koltuk</Label><Input value={seat} onChange={(event) => setSeat(event.target.value.toUpperCase())} placeholder="12A" /></div>
              <div className="sm:col-span-2"><Label>Varış / not</Label><Input value={destination} onChange={(event) => setDestination(event.target.value)} /></div>
            </div>
            {matchedFlight && (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
                <div className="flex items-center gap-2 font-medium"><Plane className="h-4 w-4 text-primary" />{matchedFlight.departureCode || matchedFlight.arrivalCode}</div>
                <p className="mt-1 text-sm text-muted-foreground">{matchedFlight.departureIATA || "-"} → {matchedFlight.arrivalIATA || "-"} · Gate/park: {matchedFlight.parkPosition || "—"} · Kalkış: {matchedFlight.departureTime || "—"}</p>
              </div>
            )}
            <div>
              <Label>WCH hizmet tipi</Label>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {(["STEP", "RAMP", "CABIN"] as const).map((type) => (
                  <Button key={type} type="button" variant={passengerType === type ? "default" : "outline"} onClick={() => setPassengerType(type)}>{type}</Button>
                ))}
              </div>
            </div>
            <Button className="w-full" size="lg" onClick={createRecord}><ClipboardCheck />WCH hizmetini üstlen</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><MapPin className="h-5 w-5 text-primary" />Aktif teslimler</CardTitle>
            <CardDescription>Yolcuyu gate'e bıraktığınızda ve boarding başladığında ilgili adıma basın.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {activeRecords.length === 0 && <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Henüz teslim kaydı yok.</div>}
            {activeRecords.map((record) => (
              <div key={record.id} className="rounded-xl border border-border bg-background/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="font-medium">{record.passengerName}</p><p className="text-sm text-muted-foreground">{record.flightCode} · {record.destination || "Varış yok"} · {record.passengerType}</p></div>
                  <Badge variant="outline">{stageLabels[record.stage]}</Badge>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-1">
                  {(["ready", "gate", "boarding"] as const).map((stage) => (
                    <Button key={stage} size="sm" variant={record.stage === stage ? "default" : "outline"} onClick={() => updateStage(record.id, stage)} className="text-xs">
                      {record.stage === stage && <Check className="h-3 w-3" />}{stageLabels[stage]}
                    </Button>
                  ))}
                </div>
                <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground"><UserRound className="h-3 w-3" />Son güncelleme: {record.updatedBy}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default TeslimPage;
