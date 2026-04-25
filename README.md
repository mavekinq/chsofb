

Calisma programi Excel dosyasini JSON'a cevirmek icin:

`npm run import:schedule -- "17.HAFTA YH ÇALIŞMA PROGRAMI.xlsx"`

Kaynak dosya verilmezse proje klasorundeki en yeni `.xlsx` dosyasi secilir:

`npm run import:schedule`

Admin panelinden dogrudan `.xlsx` veya ayni JSON formatindaki dosya yuklenebilir. Yuklenen veri tarayicida saklanir ve Calisma Programi sayfasi yeni haftayi aninda kullanir.

## Web Push Kurulumu

Gercek arka plan bildirimleri icin asagidaki adimlar gereklidir:

1. VAPID anahtarlarini uretin.
	`npx web-push generate-vapid-keys`
2. Frontend ortam degiskeni ekleyin.
	`VITE_VAPID_PUBLIC_KEY=...`
3. Supabase secret'larini ekleyin.
	`supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:ops@example.com`
4. Veritabani migration'larini uygulayin.
	`supabase db push`
5. Edge Function'i deploy edin.
	`supabase functions deploy send-service-push --no-verify-jwt`

Push abonelikleri `push_subscriptions` tablosunda saklanir. Hizmet eklendiginde istemci `send-service-push` Edge Function'unu cagirir ve tum aktif abonelere Web Push gonderilir.

## Google Sheets Senkronizasyonu

Seflerin gunluk izleme ekrani icin Google Sheets cikti hedefi olarak kullanilabilir. Bu repo icinde deploy etmeye hazir Google Apps Script endpoint'i yer alir:

- Script dosyasi: [scripts/google-sheets-sync.gs](c:/Users/Argech/wheelie-watch-pro/scripts/google-sheets-sync.gs)
- Kurulum rehberi: [docs/google-sheets-sync.md](c:/Users/Argech/wheelie-watch-pro/docs/google-sheets-sync.md)

Onerilen akis:

1. Ust blok: departure ucuslari
2. Orta blok: ozel durum/not girilen hizmet kayitlari
3. Alt blok: envanter ozeti ve vardiya devirleri

Not: Frontend'den Google Apps Script'e dogrudan yazmak guvenlik ve yetkilendirme acisindan sinirlidir. Uretim ortami icin istemci yerine Supabase Edge Function veya benzeri bir ara katman uzerinden webhook cagrisi yapilmasi onerilir.

Bu repo icinde bu amacla `sync-google-sheets` Edge Function'i bulunur. Deploy adimlari:

1. Secret ayarlari:
	`supabase secrets set GOOGLE_SHEETS_SYNC_URL="https://script.google.com/macros/s/.../exec" GOOGLE_SHEETS_SYNC_TOKEN=""`
2. Function deploy:
	`supabase functions deploy sync-google-sheets --no-verify-jwt`

Admin panelindeki `Sheets'e Senkronize Et` aksiyonu bu function'i cagirir.

### 7/24 Otomatik Senkron Kurulumu

Sayfanin kapali oldugu zamanlarda da otomatik olarak Google Sheets'e veri gondermek icin Supabase pg_cron ile server-side senkronizasyon kurulebilir:

1. **Deployment Adimlar:**

   a. Migration'i Supabase'e push edin:
   ```bash
   supabase db push
   ```

   b. Edge Function'i deploy edin:
   ```bash
   supabase functions deploy sync-google-sheets-auto --no-verify-jwt
   ```

   c. Supabase dashboard'da Environment Variables ayarlarini kontrol edin:
   - `SUPABASE_URL`: Otomatik ayarli
   - `SUPABASE_SERVICE_ROLE_KEY`: Otomatik ayarli
   - `GOOGLE_SHEETS_SYNC_URL`: Apps Script endpoint URL'i
   - `GOOGLE_SHEETS_SYNC_TOKEN`: Apps Script token'i (opsiyonel)

2. **Dogrulama:**
   - Supabase dashboard > SQL Editor'de asagidaki query'i calistirin:
     ```sql
     SELECT * FROM cron.job WHERE jobname LIKE '%sync-google-sheets%';
     ```
   - Eger sonuc dönerse, cron job basariyla kurulmuştur.

3. **Kontrol:**
   - Google Sheets'te Logs sekmesini acip, son 10 dakikada otomatik sync'i görün.
   - Logs icinde `[AUTO-SYNC]` prefix'i ile istisnalar kaydedilir.

**Not:** Migration ilk push edildiginde pg_cron extension ve http extension otomatik enable edilir. Eger hata alirsa (`net.http_post undefined`), Supabase UI'su icinde `extensions` schema'da `http` ve `pg_cron` extensions'larinin kurulu degerlendirme yapiniz.
