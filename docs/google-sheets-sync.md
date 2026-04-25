# Google Sheets Sync Endpoint

Bu dokuman, sitedeki departure ucuslari, ozel durumlu hizmet kayitlari ve envanter/devir ozetlerini Google Sheets'e yazmak icin Google Apps Script endpoint'ini kurar.

## 1. Script'i Olustur

1. [Google Apps Script](https://script.google.com/) uzerinde yeni bir proje ac.
2. Bu repo icindeki [scripts/google-sheets-sync.gs](c:/Users/Argech/wheelie-watch-pro/scripts/google-sheets-sync.gs) dosyasinin tamamini `Code.gs` yerine yapistir.
3. `CONFIG.spreadsheetId` alaninin senin sheet id'in oldugunu kontrol et.
4. Gerekirse `CONFIG.token` alanina paylasilmayan bir token yaz.

## 2. Web App Olarak Deploy Et

1. `Deploy` > `New deployment` sec.
2. Type olarak `Web app` sec.
3. `Execute as`: `Me`
4. `Who has access`: test icin `Anyone`, gerekiyorsa `Anyone with the link`
5. Deploy et ve olusan `/exec` URL'sini kaydet.

## 3. Beklenen Payload

Endpoint `POST` ile su JSON yapisini kabul eder:

```json
{
  "departures": [
    {
      "updatedAt": "2026-04-25 09:30:00",
      "departureTime": "10:15",
      "airline": "PC",
      "flightCode": "PC2012",
      "destination": "SAW",
      "terminal": "T1",
      "gate": "12",
      "status": "scheduled",
      "delayMinutes": 0,
      "plannedPosition": "203"
    }
  ],
  "specialServices": [
    {
      "createdAt": "2026-04-25 09:40:00",
      "flightCode": "PC2012",
      "airline": "PC",
      "destination": "SAW",
      "terminal": "T1",
      "gate": "12",
      "passengerType": "RAMP",
      "assignedStaff": "Ali Veli",
      "createdBy": "Ali Veli",
      "wheelchairId": "WC-12",
      "specialNotes": "Yolcu refakat istiyor"
    }
  ],
  "inventorySummary": [
    {
      "updatedAt": "2026-04-25 09:45:00",
      "terminal": "T1",
      "available": 18,
      "missing": 2,
      "maintenance": 1
    }
  ],
  "handovers": [
    {
      "createdAt": "2026-04-25 08:00:00",
      "terminal": "T1",
      "fromStaff": "Ahmet Yilmaz",
      "toStaff": "Mehmet Kaya",
      "snapshot": "✅18 🔴2 🟠1",
      "checklist": "Sandalye sayildi, ofis temiz"
    }
  ]
}
```

## 4. Test Et

`GET /exec`

Beklenen cevap: endpoint ayakta oldugunu gosteren basit bir JSON.

`POST /exec`

Ornek `curl`:

```bash
curl -X POST "YOUR_WEBAPP_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "departures": [],
    "specialServices": [],
    "inventorySummary": [],
    "handovers": []
  }'
```

Token kullaniyorsan URL'ye `?token=YOUR_SECRET` ekle.

## 5. Supabase Edge Function Uzerinden Guvenli Baglanti

Doğrudan tarayicidan Apps Script cagirisi yerine Supabase Edge Function kullan.

### Secret'lari ayarla

```bash
supabase secrets set \
  GOOGLE_SHEETS_SYNC_URL="https://script.google.com/macros/s/.../exec" \
  GOOGLE_SHEETS_SYNC_TOKEN=""
```

### Function deploy et

```bash
supabase functions deploy sync-google-sheets --no-verify-jwt
```

Bu function dosyasi: [supabase/functions/sync-google-sheets/index.ts](c:/Users/Argech/wheelie-watch-pro/supabase/functions/sync-google-sheets/index.ts)

## 6. Bu Projeye Baglama Onerisi

Bu projede veri kaynaklari zaten mevcut:

- Departure ucuslari: [src/pages/WheelchairServicesPage.tsx](c:/Users/Argech/wheelie-watch-pro/src/pages/WheelchairServicesPage.tsx)
- Ozel notlu hizmet kayitlari: [src/pages/WheelchairServicesPage.tsx](c:/Users/Argech/wheelie-watch-pro/src/pages/WheelchairServicesPage.tsx)
- Envanter ozeti: [src/pages/WheelchairServicesPage.tsx](c:/Users/Argech/wheelie-watch-pro/src/pages/WheelchairServicesPage.tsx)
- Vardiya devirleri: [src/pages/AdminControlPage.tsx](c:/Users/Argech/wheelie-watch-pro/src/pages/AdminControlPage.tsx)

Uretim icin uygulanan akis:

1. Frontend veriyi toplar.
2. Frontend `sync-google-sheets` Edge Function'a yollar.
3. Edge Function Google Apps Script endpoint'ine POST atar.

Bu sayede token ve endpoint istemciye acik edilmez.