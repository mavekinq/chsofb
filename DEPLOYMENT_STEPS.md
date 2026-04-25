# 7/24 Otomatik Sunucu Senkron - Deployment Checklist

Bu belge, Supabase pg_cron ile Google Sheets'e otomatik 24/7 veri senkronizasyonunun kurulumunu açıklamaktadır.

## Ön Koşullar

- Supabase CLI kurulu (`npm install -g supabase` veya `brew install supabase`)
- Supabase project erişim (project URL + service role key)
- Google Apps Script endpoint URL'i ve token'i (mevcut olmalı)

## Adım 1: Environment Variables'ı Ayarlayın

Supabase dashboard'daki **Settings > Edge Functions** > **Secrets** bölümüne gidin ve şu değerleri ekleyin:

```
GOOGLE_SHEETS_SYNC_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
GOOGLE_SHEETS_SYNC_TOKEN=YOUR_OPTIONAL_AUTH_TOKEN
```

## Adım 2: Database Migration'ını Push Edin

Terminal'de şu komutu çalıştırın:

```bash
supabase db push
```

Bu komut:
- `pg_cron` extension'ını enable eder
- `http` extension'ını enable eder  
- `sync-google-sheets-auto-1min` adında bir cron job oluşturur (her dakika çalışır)

Çıkış şöyle görünmelidir:
```
✔ Applied migration (supabase/migrations/20260426_setup_cron_sheets_sync.sql)
```

## Adım 3: sync-google-sheets-auto Edge Function'ını Deploy Edin

Terminal'de şu komutu çalıştırın:

```bash
supabase functions deploy sync-google-sheets-auto --no-verify-jwt
```

Bu komut:
- `supabase/functions/sync-google-sheets-auto/index.ts` dosyasını Supabase'e yükler
- JWT doğrulaması devre dışı bırakır (cron job'dan erişim için gerekli)

Çıkış şöyle görünmelidir:
```
✔ Function 'sync-google-sheets-auto' successfully deployed
```

## Adım 4: Deployment Doğrulaması

### 4A: Cron Job Varlığını Kontrol Edin

Supabase dashboard'daki **SQL Editor**'e gidin ve şu sorguyu çalıştırın:

```sql
SELECT jobname, schedule, command 
FROM cron.job 
WHERE jobname LIKE '%sync-google-sheets%';
```

Sonuç olarak 1 satır dönmelidir:
- `jobname`: `sync-google-sheets-auto-1min`
- `schedule`: `* * * * *` (her dakika)

### 4B: Edge Function İçin Logs Kontrol Edin

Supabase dashboard'daki **Functions** > **sync-google-sheets-auto** bölümüne gidin ve logs'u açın.

Yaklaşık 1 dakika sonra, şu şekilde bir log girişi görünmelidir:
```
{
  "success": true,
  "upstreamStatus": 200,
  "upstream": {...}
}
```

Hata varsa logs'ta şu şekilde görünecektir:
```
{
  "error": "Missing required environment variables"
}
```

### 4C: Google Sheets'te Kontrol Edin

Google Sheets'teki **Logs** sekmesini açın. Son 5-10 dakikada otomatik sync'ler kaydedilmiş olmalıdır:
- Timestamp + `[AUTO-SYNC]` prefix'i ile kaydedilir

## Adım 5: Sorun Giderme

### Problem: Cron job'u çalışmıyor

**Çözüm adımları:**

1. Supabase SQL Editor'de pg_cron extension'ının mevcut olduğunu kontrol edin:
   ```sql
   SELECT * FROM pg_extension WHERE extname = 'pg_cron';
   ```

2. http extension'ını kontrol edin:
   ```sql
   SELECT * FROM pg_extension WHERE extname = 'http';
   ```

3. Cron job'une doğrudan trigger atayın teste:
   ```sql
   SELECT cron.force_now('sync-google-sheets-auto-1min');
   ```

4. Function logs'u kontrol edin.

### Problem: `net.http_post undefined` hatası

Bu hata, `http` extension'ının enable edilmediği anlamına gelir.

**Çözüm:**

Supabase SQL Editor'de şu sorguyu çalıştırın:
```sql
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;
```

Ardından migration'ı yeniden push edin:
```bash
supabase db push
```

### Problem: `GOOGLE_SHEETS_SYNC_URL` hatası

Environment variable'ın ayarlanmadığı anlamına gelir.

**Çözüm:**

1. Supabase dashboard'da **Settings > Edge Functions > Secrets** bölümüne gidin
2. `GOOGLE_SHEETS_SYNC_URL` ve `GOOGLE_SHEETS_SYNC_TOKEN`'ı ekleyin
3. Secrets ekledikten sonra 30 saniye bekleyin (cron job'u sonraki dakika çalışana kadar)

## Adım 6: Monitoring ve Maintenance

### Günlük Kontrol

Haftada 1 kez Google Sheets'teki **Logs** sekmesini açıp, otomatik sync'lerin kaydedilip kaydedilmediğini kontrol edin.

### Cron Job'u Devre Dışı Bırakmak (gerekirse)

```sql
SELECT cron.unschedule('sync-google-sheets-auto-1min');
```

### Cron Job Zaman Aralığını Değiştirmek

Örneğin, 5 dakikada bir çalışması için:

```bash
# Mevcut job'u silin
supabase db push -- --sql "SELECT cron.unschedule('sync-google-sheets-auto-1min');"

# Migration'ı güncelleyin (schedule: '*/5 * * * *')
# Ardından push edin
supabase db push
```

## Hızlı Referans

| Görev | Komut |
|-------|-------|
| Migration push | `supabase db push` |
| Function deploy | `supabase functions deploy sync-google-sheets-auto --no-verify-jwt` |
| Cron job listesi | `SELECT * FROM cron.job;` (Supabase SQL Editor) |
| Function logs | Supabase dashboard > Functions > sync-google-sheets-auto |
| Cron job'u test | `SELECT cron.force_now('sync-google-sheets-auto-1min');` |

## Notlar

- Eğer Supabase CLI yerel makinenizde yoksa, Supabase dashboard'dan SQL Editor üzerinden migration'ı manuel olarak çalıştırabilirsiniz:
  - SQL Editor'de migration dosyasının içeriğini yapıştırın ve çalıştırın

- Edge Function'ları Supabase dashboard'dan da deploy edebilirsiniz ama CLI daha güvenilirdir

- İlk cron job'unun çalışması için migration push'ından sonra yaklaşık 1 dakika bekleyin
