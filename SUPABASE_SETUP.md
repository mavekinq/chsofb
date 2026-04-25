# Supabase Users Tablosu Kurulumu

## Sorun
Login sisteminde "Kullanıcı kontrol edilemedi" hatası alıyorsunuz çünkü `users` tablosu Supabase'te oluşturulmamış.

## Çözüm (3 adım)

### Adım 1: Supabase Dashboard'a Git
1. Tarayıcıda **Supabase Dashboard**'ı aç
2. Senin proje seçeneğine tıkla

### Adım 2: SQL Editor Aç
1. Sol menüden **"SQL Editor"** seçeneğini klik et
2. **"New Query"** butonuna tıkla

### Adım 3: SQL Kodu Çalıştır
1. Aşağıdaki SQL kodunu **tamamen kopyala**:

```sql
-- Create users table
CREATE TABLE public.users (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name text NOT NULL UNIQUE,
  security_number text,
  notification_enabled boolean DEFAULT false,
  is_admin boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable Row Level Security
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- RLS Policy 1: Allow public SELECT
CREATE POLICY "Allow public select on users"
  ON public.users
  AS PERMISSIVE
  FOR SELECT
  USING (true);

-- RLS Policy 2: Allow public INSERT
CREATE POLICY "Allow public insert on users"
  ON public.users
  AS PERMISSIVE
  FOR INSERT
  WITH CHECK (true);

-- RLS Policy 3: Allow public UPDATE
CREATE POLICY "Allow public update on users"
  ON public.users
  AS PERMISSIVE
  FOR UPDATE
  USING (true)
  WITH CHECK (true);
```

2. SQL Editor'e **yapıştır** (paste et)
3. **"Run"** butonuna tıkla
4. Başarı mesajı gelirse, tamamlandı! ✅

## Sonra Ne?

Tablo oluşturulduktan sonra, login ekranında:
1. Ad soyad gir (shift'te birisinin adı olmalı)
2. Bildirim izni sorulsun
3. Sicil numarası sor
4. Giriş yap

**Başarılı olacak!** 🎉
