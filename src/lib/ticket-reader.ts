import { createWorker, PSM } from "tesseract.js";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { isBcbpData, parseBCBP } from "@/lib/bcbp";

export interface TicketPassengerData {
  passengerName: string;
  flightCode: string;
  pnr: string;
  seat: string;
  destination: string;
}

const extractValue = (text: string, labels: string[]) => {
  const labelPattern = labels.join("|");
  const match = text.match(new RegExp(`(?:${labelPattern})\\s*[:#-]?\\s*([^\\n|;,]+)`, "iu"));
  return match?.[1]?.trim() || "";
};

export const parseTicket = (rawText: string): TicketPassengerData => {
  const bcbp = parseBCBP(rawText);
  if (isBcbpData(bcbp)) {
    return {
      passengerName: bcbp.passengerName || "",
      flightCode: `${bcbp.airline || ""}${bcbp.flightNumber || ""}`,
      pnr: bcbp.pnr || "",
      seat: bcbp.seat || "",
      destination: bcbp.destination || "",
    };
  }

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

export const prepareTicketImage = (file: File, enhance = true): Promise<HTMLCanvasElement> =>
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
      if (enhance) {
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
      }
      resolve(canvas);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Görsel yüklenemedi"));
    };
    image.src = objectUrl;
  });

export const readTicketBarcode = (images: HTMLCanvasElement[]) => {
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.PDF_417,
    BarcodeFormat.AZTEC,
    BarcodeFormat.DATA_MATRIX,
  ]);
  hints.set(DecodeHintType.TRY_HARDER, true);

  try {
    const reader = new BrowserMultiFormatReader(hints);
    for (const image of images) {
      try {
        return reader.decodeFromCanvas(image).getText();
      } catch {
        // Try another image variant before falling back to OCR.
      }
    }
  } catch {
    // Barcode decoding is optional; OCR remains the fallback.
  }
  return "";
};

export const readTicketFile = async (file: File): Promise<TicketPassengerData> => {
  if (!file.type.startsWith("image/")) {
    if (!file.type.includes("text") && !/\.(txt|csv)$/i.test(file.name)) {
      throw new Error("Şimdilik görsel, TXT veya CSV bilet yükleyebilirsiniz.");
    }
    return parseTicket(await file.text());
  }

  const rawImage = await prepareTicketImage(file, false);
  const preparedImage = await prepareTicketImage(file);
  const barcodeText = readTicketBarcode([rawImage, preparedImage]);
  const worker = await createWorker("tur+eng");
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      preserve_interword_spaces: "1",
      user_defined_dpi: "300",
    });
    const result = await worker.recognize(preparedImage, { rotateAuto: true });
    return parseTicket([barcodeText, result.data.text].filter(Boolean).join("\n"));
  } finally {
    await worker.terminate();
  }
};
