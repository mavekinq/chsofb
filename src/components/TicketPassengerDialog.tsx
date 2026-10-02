import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Accessibility, Armchair, Camera, Check, Loader2, MapPin, Plane, RefreshCw, ScanLine, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getFlightCodeMatchKeys, normalizeFlightCode } from "@/lib/flight-plan";
import { isBcbpData, parseBCBP } from "@/lib/bcbp";
import { parseTicket, readTicketBarcode, type TicketPassengerData } from "@/lib/ticket-reader";

export interface TicketFlight {
  airline_iata: string;
  arr_iata: string;
  dep_estimated?: string;
  dep_gate: string | null;
  dep_iata: string;
  dep_terminal: string | null;
  dep_time: string;
  flight_iata: string;
  flight_number: string;
}

export type TicketPassenger = Pick<TicketPassengerData, "passengerName" | "seat">;
export type TicketPassengerType = "STEP" | "RAMP" | "CABIN";

export interface TicketWheelchair {
  id: string;
  wheelchair_id: string;
}

interface TicketServiceInfo {
  wheelchairId: string;
  passengerType: TicketPassengerType;
  notes: string;
}

interface TicketPassengerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  flights: TicketFlight[];
  terminalLabel: string;
  wheelchairs: TicketWheelchair[];
  currentUser: string;
  onFlightSelected: (flight: TicketFlight) => void;
  onConfirm: (flight: TicketFlight, passenger: TicketPassenger, service: TicketServiceInfo) => Promise<void>;
}

type ScanStage = "camera" | "reading" | "ticket";

const flightMatchKeys = (flight: TicketFlight) => [
  ...getFlightCodeMatchKeys(flight.flight_iata),
  ...getFlightCodeMatchKeys(`${flight.airline_iata}${flight.flight_number}`),
];

const TicketPassengerDialog = ({
  open,
  onOpenChange,
  flights,
  terminalLabel,
  wheelchairs,
  currentUser,
  onFlightSelected,
  onConfirm,
}: TicketPassengerDialogProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<number | null>(null);
  const scanBusyRef = useRef(false);
  const reduceMotion = useReducedMotion();
  const [stage, setStage] = useState<ScanStage>("camera");
  const [cameraAttempt, setCameraAttempt] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [passengerName, setPassengerName] = useState("");
  const [flightCode, setFlightCode] = useState("");
  const [pnr, setPnr] = useState("");
  const [seat, setSeat] = useState("");
  const [destination, setDestination] = useState("");
  const [selectedFlightIata, setSelectedFlightIata] = useState("");
  const [passengerType, setPassengerType] = useState<TicketPassengerType>("STEP");
  const [wheelchairId, setWheelchairId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const matchingFlights = useMemo(() => {
    const keys = new Set(getFlightCodeMatchKeys(flightCode));
    if (!keys.size) return [];
    return flights.filter((flight) => flightMatchKeys(flight).some((key) => keys.has(key)));
  }, [flightCode, flights]);

  const selectedFlight = flights.find((flight) => flight.flight_iata === selectedFlightIata) || null;
  const selectedFlightTime = selectedFlight?.dep_time || selectedFlight?.dep_estimated || "Saat yok";

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    let stream: MediaStream | null = null;
    const videoElement = videoRef.current;
    setCameraStarting(true);
    setCameraError("");
    setCameraReady(false);

    const startCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError("Bu tarayıcı kamera kullanımını desteklemiyor.");
        setCameraStarting(false);
        return;
      }

      const existingStream = cameraStreamRef.current;
      if (existingStream?.getVideoTracks().some((track) => track.readyState === "live")) {
        setCameraReady(true);
        setCameraStarting(false);
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        cameraStreamRef.current = stream;
        if (!cancelled) setCameraReady(true);
      } catch (error) {
        if (stream) stream.getTracks().forEach((track) => track.stop());
        if (!cancelled) {
          console.error("Ticket scan camera failed:", error);
          setCameraError("Kamera açılamadı. Tarayıcı kamera iznini kontrol edip yeniden deneyin.");
        }
      } finally {
        if (!cancelled) setCameraStarting(false);
      }
    };

    void startCamera();
    return () => {
      cancelled = true;
      const activeStream = cameraStreamRef.current;
      activeStream?.getTracks().forEach((track) => track.stop());
      if (cameraStreamRef.current === activeStream) cameraStreamRef.current = null;
      if (videoElement) videoElement.srcObject = null;
      setCameraReady(false);
    };
  }, [cameraAttempt, open]);

  useEffect(() => {
    if (!open || stage !== "camera" || !cameraReady) return;

    const video = videoRef.current;
    const stream = cameraStreamRef.current;
    if (!video || !stream) return;

    video.srcObject = stream;
    void video.play().catch((error: unknown) => {
      console.error("Ticket scan video playback failed:", error);
      setCameraError("Kamera görüntüsü başlatılamadı. Yeniden deneyin.");
      setCameraReady(false);
    });
  }, [cameraReady, open, stage]);

  useEffect(() => {
    if (!open || stage !== "camera" || !cameraReady) return;

    scanTimerRef.current = window.setInterval(async () => {
      const video = videoRef.current;
      if (scanBusyRef.current || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) return;

      scanBusyRef.current = true;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Kamera görüntüsü okunamadı.");
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        const barcodeText = readTicketBarcode([canvas]);
        if (!barcodeText || !isBcbpData(parseBCBP(barcodeText))) return;

        setStage("reading");
        const parsed = parseTicket(barcodeText);
        if (!parsed.passengerName || !parsed.flightCode) {
          throw new Error("Biniş kartı bulundu ancak yolcu veya uçuş bilgisi okunamadı. Kartı yeniden tarayın.");
        }

        setPassengerName(parsed.passengerName);
        setFlightCode(normalizeFlightCode(parsed.flightCode));
        setPnr(parsed.pnr);
        setSeat(parsed.seat.toUpperCase());
        setDestination(parsed.destination);

        const keys = new Set(getFlightCodeMatchKeys(parsed.flightCode));
        const matches = flights.filter((flight) => flightMatchKeys(flight).some((key) => keys.has(key)));
        setSelectedFlightIata(matches.length === 1 ? matches[0].flight_iata : "");
        if (matches.length === 1) onFlightSelected(matches[0]);
        setStage("ticket");
        toast.success(matches.length === 1
          ? `${matches[0].flight_iata} uçuşu eşleştirildi. Yolcu bilgilerini kontrol edin.`
          : "Biniş kartı okundu. Uçuşu kontrol edip listeden seçin.");
      } catch (error) {
        console.error("Ticket boarding-pass scan failed:", error);
        setCameraError(error instanceof Error ? error.message : "Biniş kartı okunamadı.");
        setStage("camera");
        setCameraAttempt((attempt) => attempt + 1);
      } finally {
        scanBusyRef.current = false;
      }
    }, 450);

    return () => {
      if (scanTimerRef.current !== null) {
        window.clearInterval(scanTimerRef.current);
        scanTimerRef.current = null;
      }
    };
  }, [cameraReady, flights, onFlightSelected, open, stage]);

  useEffect(() => {
    if (open) return;
    setStage("camera");
    setCameraAttempt(0);
    setCameraError("");
    setPassengerName("");
    setFlightCode("");
    setPnr("");
    setSeat("");
    setDestination("");
    setSelectedFlightIata("");
    setPassengerType("STEP");
    setWheelchairId("");
    setNotes("");
    setSaving(false);
  }, [open]);

  const retryCamera = () => {
    setCameraError("");
    setPassengerName("");
    setFlightCode("");
    setPnr("");
    setSeat("");
    setDestination("");
    setSelectedFlightIata("");
    setPassengerType("STEP");
    setWheelchairId("");
    setNotes("");
    const streamIsLive = cameraStreamRef.current?.getVideoTracks()
      .some((track) => track.readyState === "live") ?? false;
    setStage("camera");
    if (streamIsLive) {
      setCameraReady(true);
    } else {
      setCameraAttempt((attempt) => attempt + 1);
    }
  };

  const handleConfirm = async () => {
    if (!selectedFlight || !passengerName.trim() || !wheelchairId) {
      toast.error("Yolcu, uçuş ve tekerlekli sandalye seçimi gerekli.");
      return;
    }

    setSaving(true);
    try {
      await onConfirm(
        selectedFlight,
        { passengerName: passengerName.trim(), seat: seat.trim().toUpperCase() },
        { wheelchairId, passengerType, notes: notes.trim() },
      );
      onOpenChange(false);
    } catch (error) {
      console.error("Ticket WCH service save failed:", error);
      toast.error(error instanceof Error ? error.message : "WCH hizmeti kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  };

  const handleFlightCodeChange = (value: string) => {
    const normalized = normalizeFlightCode(value);
    setFlightCode(normalized);
    const keys = new Set(getFlightCodeMatchKeys(normalized));
    const matches = flights.filter((flight) => flightMatchKeys(flight).some((key) => keys.has(key)));
    setSelectedFlightIata(matches.length === 1 ? matches[0].flight_iata : "");
    if (matches.length === 1) onFlightSelected(matches[0]);
  };

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="h-5 w-5 text-primary" />
            {stage === "ticket" ? "Yolcu ve WCH hizmeti" : "Bilet ile yolcu ekle"}
          </DialogTitle>
          <DialogDescription>
            {stage === "ticket"
              ? "Biniş kartı bilgilerini kontrol edin, WCH hizmetini seçin ve bu ekrandan kaydedin."
              : stage === "reading"
                ? "Biniş kartı bulundu, bilgileri hazırlanıyor..."
                : `${terminalLabel} uçuşlarını tarayabilirsiniz. Kart algılandığında bilgiler otomatik okunur ve doğru terminal seçilir.`}
          </DialogDescription>
        </DialogHeader>

        <AnimatePresence mode="wait" initial={false}>
          {stage === "camera" && (
            <motion.div
              key="camera"
              initial={reduceMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: reduceMotion ? 0.12 : 0.2 }}
              className="space-y-3"
            >
              <div className="relative overflow-hidden rounded-xl border border-primary/30 bg-black">
                <video
                  ref={videoRef}
                  className="aspect-[4/3] w-full object-contain"
                  autoPlay
                  playsInline
                  muted
                  aria-label="Biniş kartı tarama kamerası"
                />
                <div className="pointer-events-none absolute inset-x-7 top-1/2 -translate-y-1/2">
                  <div className="relative aspect-[1.75/1] rounded-xl border-2 border-dashed border-white/80 shadow-[0_0_0_999px_rgba(0,0,0,0.28)]">
                    {cameraReady && (
                      <span className="ticket-scan-line absolute inset-x-0 top-0 h-0.5 bg-primary shadow-[0_0_12px_3px_hsl(var(--primary)/0.8)]" />
                    )}
                  </div>
                </div>
                {!cameraReady && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 px-6 text-center text-sm text-white">
                    {cameraStarting ? <Loader2 className="h-7 w-7 animate-spin" /> : <Camera className="h-7 w-7" />}
                    <span>{cameraError || "Kamera başlatılıyor..."}</span>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {cameraReady ? "Biniş kartını çerçeveye alın; barkod net göründüğünde otomatik taranır." : "Kamera bağlanıyor..."}
                </p>
                {cameraError && (
                  <Button type="button" variant="outline" size="sm" onClick={retryCamera}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Yeniden dene
                  </Button>
                )}
              </div>
            </motion.div>
          )}

          {stage === "reading" && (
            <motion.div
              key="reading"
              initial={reduceMotion ? false : { opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="flex min-h-64 flex-col items-center justify-center gap-4 rounded-xl border border-primary/20 bg-primary/5 p-8 text-center"
            >
              <div className="rounded-full bg-primary/10 p-4 text-primary">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
              <div>
                <p className="font-semibold">Biniş kartı okunuyor</p>
                <p className="mt-1 text-sm text-muted-foreground">Yolcu ve uçuş bilgileri eşleştiriliyor.</p>
              </div>
            </motion.div>
          )}

          {stage === "ticket" && (
            <form
              key="ticket"
              onSubmit={(event) => {
                event.preventDefault();
                void handleConfirm();
              }}
            >
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: 24, rotateX: 7, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, rotateX: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8 }}
              transition={reduceMotion ? { duration: 0.12 } : { type: "spring", stiffness: 240, damping: 22 }}
              className="space-y-4"
            >
              <div className="overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-br from-card via-card to-primary/10 shadow-lg">
                <div className="flex items-center justify-between border-b border-dashed border-border px-5 py-3">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                    <Plane className="h-4 w-4" />
                    Boarding pass
                  </div>
                  <Badge variant="outline">{selectedFlight?.dep_terminal || terminalLabel}</Badge>
                </div>
                <div className="space-y-5 p-5">
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Yolcu / Passenger</p>
                    <p className="mt-1 text-xl font-bold tracking-wide">{passengerName || "—"}</p>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Uçuş / Flight</p>
                      <p className="mt-1 text-lg font-semibold">{selectedFlight?.flight_iata || flightCode || "—"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Koltuk / Seat</p>
                      <p className="mt-1 text-lg font-semibold">{seat || "—"}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3 rounded-xl bg-background/60 p-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Kalkış</p>
                      <p className="mt-1 font-semibold">{selectedFlight?.dep_iata || "—"}</p>
                    </div>
                    <div className="flex flex-col items-center justify-center text-primary">
                      <Plane className="h-4 w-4" />
                      <span className="text-[10px]">{selectedFlightTime}</span>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Varış</p>
                      <p className="mt-1 font-semibold">{selectedFlight?.arr_iata || destination || "—"}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                    {pnr && <span>PNR <strong className="text-foreground">{pnr}</strong></span>}
                    {selectedFlight?.dep_gate && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" /> Gate {selectedFlight.dep_gate}
                      </span>
                    )}
                    {destination && <span>Varış bilgisi: {destination}</span>}
                  </div>
                </div>
                <div aria-hidden="true" className="h-9 border-t border-dashed border-border opacity-50 [background:repeating-linear-gradient(90deg,transparent_0_4px,hsl(var(--foreground))_4px_6px,transparent_6px_10px)]" />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="ticket-passenger-name">Yolcu adı</Label>
                  <Input id="ticket-passenger-name" autoComplete="off" value={passengerName} onChange={(event) => setPassengerName(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ticket-flight-code">Biletteki uçuş kodu</Label>
                  <Input id="ticket-flight-code" autoComplete="off" value={flightCode} onChange={(event) => handleFlightCodeChange(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ticket-seat">Koltuk</Label>
                  <Input id="ticket-seat" autoComplete="off" value={seat} onChange={(event) => setSeat(event.target.value.toUpperCase())} />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="ticket-matched-flight">Eşleşen kalkış uçuşu</Label>
                    {selectedFlight && <Badge variant="secondary">{selectedFlightTime}</Badge>}
                  </div>
                  <Select
                    value={selectedFlightIata}
                    onValueChange={(flightIata) => {
                      setSelectedFlightIata(flightIata);
                      const flight = flights.find((item) => item.flight_iata === flightIata);
                      if (flight) onFlightSelected(flight);
                    }}
                  >
                    <SelectTrigger id="ticket-matched-flight" aria-label="Uçuş seçin">
                      <SelectValue placeholder="Bilet uçuşunu seçin" />
                    </SelectTrigger>
                    <SelectContent>
                      {flights.map((flight, index) => (
                        <SelectItem key={`${flight.flight_iata}-${index}`} value={flight.flight_iata}>
                          {flight.flight_iata} · {flight.dep_iata} → {flight.arr_iata || "—"} · {flight.dep_time || flight.dep_estimated || "Saat yok"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {flightCode && matchingFlights.length === 0 && (
                    <p className="text-xs text-amber-300">Bilet uçuşu otomatik eşleşmedi; doğru uçuşu listeden seçin.</p>
                  )}
                </div>
              </div>
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Armchair className="h-4 w-4 shrink-0" />
                Okutulan yolcunun WCH hizmet bilgilerini girin.
              </p>

              <div className="space-y-4 rounded-xl border border-border bg-background/40 p-4">
                <div className="space-y-2">
                  <Label>Yolcu hizmet tipi</Label>
                  <div className="grid grid-cols-3 gap-2" role="group" aria-label="Yolcu hizmet tipi">
                    {(["STEP", "RAMP", "CABIN"] as const).map((type) => (
                      <Button
                        key={type}
                        type="button"
                        variant={passengerType === type ? "default" : "outline"}
                        aria-pressed={passengerType === type}
                        onClick={() => setPassengerType(type)}
                      >
                        {type}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ticket-wheelchair">
                    <span className="inline-flex items-center gap-2">
                      <Accessibility className="h-4 w-4" />
                      WCH / Tekerlekli sandalye
                    </span>
                  </Label>
                  <Select value={wheelchairId} onValueChange={setWheelchairId}>
                    <SelectTrigger id="ticket-wheelchair" aria-label="WCH sandalyesi seçin">
                      <SelectValue placeholder="WCH sandalyesi seçin" />
                    </SelectTrigger>
                    <SelectContent>
                      {wheelchairs.map((wheelchair) => (
                        <SelectItem key={wheelchair.id} value={wheelchair.wheelchair_id}>
                          {wheelchair.wheelchair_id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {wheelchairs.length === 0 && (
                    <p className="text-xs text-destructive">Bu terminalde müsait WCH sandalyesi bulunmuyor.</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ticket-assigned-staff">
                    <span className="inline-flex items-center gap-2">
                      <UserRound className="h-4 w-4" />
                      Hizmeti üstlenen hesap
                    </span>
                  </Label>
                  <Input id="ticket-assigned-staff" name="assignedStaff" value={currentUser} readOnly />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ticket-service-notes">WCH notu <span className="text-xs text-muted-foreground">(isteğe bağlı)</span></Label>
                  <Textarea
                    id="ticket-service-notes"
                    name="serviceNotes"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Yolcunun ihtiyaçları veya ek bilgi"
                    rows={2}
                  />
                </div>
              </div>
            </motion.div>
            </form>
          )}
        </AnimatePresence>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="outline" onClick={() => handleDialogOpenChange(false)}>
            <X className="mr-2 h-4 w-4" />
            İptal
          </Button>
          {stage === "ticket" && (
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={retryCamera} disabled={saving}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Yeniden tara
              </Button>
              <Button type="button" onClick={() => void handleConfirm()} disabled={saving || !passengerName.trim() || !selectedFlight || !wheelchairId}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                {saving ? "Kaydediliyor..." : "Hizmeti Kaydet"}
              </Button>
            </div>
          )}
          {stage === "reading" && <Button type="button" disabled><Loader2 className="mr-2 h-4 w-4 animate-spin" />Okunuyor</Button>}
          {stage === "camera" && cameraError && !cameraStarting && (
            <Button type="button" onClick={retryCamera}>
              <Camera className="mr-2 h-4 w-4" />
              Kamerayı aç
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TicketPassengerDialog;
