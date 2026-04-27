import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ArrowLeft, Bell, KeyRound, ShieldCheck, UserRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { hasAdminCredentials, isAdminUsername, isValidAdminPassword } from "@/lib/admin-auth";
import { loadSchedulePayload } from "@/lib/work-schedule";

type StoredStaffUser = {
  id: string;
  full_name: string;
  security_number: string;
  notification_enabled: boolean;
  updated_at: string;
};

const LOCAL_USERS_KEY = "staffAuthUsers";

const readLocalUsers = (): StoredStaffUser[] => {
  try {
    const raw = localStorage.getItem(LOCAL_USERS_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as StoredStaffUser[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed;
  } catch {
    return [];
  }
};

const writeLocalUsers = (users: StoredStaffUser[]) => {
  localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
};

const isUsersTableMissing = (message?: string) =>
  (message || "").toLowerCase().includes("could not find the table 'public.users'");

const sanitizeSecurityNumber = (value: string) => value.replace(/\D/g, "").slice(0, 8);
const isValidSecurityNumber = (value: string) => /^\d{8}$/.test(value);

const TURKISH_CHAR_FOLD_MAP: Record<string, string> = {
  "ç": "c",
  "ğ": "g",
  "ı": "i",
  "ö": "o",
  "ş": "s",
  "ü": "u",
};

// Strip shift role/team suffixes like " - LR", " -LR", " -UN", "  - UN" etc.
const stripShiftNameSuffix = (value: string) => value.split(/\s+-/)[0]?.trim() || value.trim();

const normalizeFullName = (value: string) =>
  value
    .toLocaleLowerCase("tr")
    .replace(/[çğıöşü]/g, (char) => TURKISH_CHAR_FOLD_MAP[char] || char)
    .replace(/[.'’`-]/g, " ")
    .trim()
    .replace(/\s+/g, " ")
;

type LoginStep = "name" | "admin-password" | "notification" | "security-number" | "existing-security-number";

const stepMeta = {
  name: {
    label: "Personel Girisi",
    title: "Celebi OFB",
    description: "Vardiyada gorunen ad soyadinla devam et. Sistem seni aktif vardiya ve calisma plani ile eslestirir.",
    icon: UserRound,
  },
  "admin-password": {
    label: "Yonetici Girisi",
    title: "Yonetici Dogrulama",
    description: "Yonetim ekranina gecmek icin admin sifreni gir.",
    icon: ShieldCheck,
  },
  notification: {
    label: "Bildirim Ayari",
    title: "Bildirim Tercihi",
    description: "Ucus ve hizmet akisini anlik almak icin bildirim iznini burada belirleyebilirsin.",
    icon: Bell,
  },
  "security-number": {
    label: "Ilk Kayit",
    title: "Sicil Dogrulamasi",
    description: "Ilk giris icin 8 haneli sicil numarani bir kez kaydet.",
    icon: KeyRound,
  },
  "existing-security-number": {
    label: "Tekrar Giris",
    title: "Kimlik Dogrulamasi",
    description: "Kayitli hesabina devam etmek icin sicil numarani onayla.",
    icon: KeyRound,
  },
} as const;

const Login = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState<LoginStep>("name");
  const [fullName, setFullName] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [securityNumber, setSecurityNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [foundUser, setFoundUser] = useState<any>(null);
  const [isFirstLogin, setIsFirstLogin] = useState(false);
  const [useLocalUserStore, setUseLocalUserStore] = useState(false);
  const currentStepMeta = stepMeta[step];
  const StepIcon = currentStepMeta.icon;

  const resetToNameStep = () => {
    setFullName("");
    setAdminPassword("");
    setSecurityNumber("");
    setFoundUser(null);
    setIsFirstLogin(false);
    setStep("name");
  };

  // Validate name in shifts table
  const validateNameInShifts = async (name: string): Promise<string | null> => {
    if (!name.trim()) {
      toast.error("Ad soyad boş olamaz");
      return null;
    }

    const normalizedInput = normalizeFullName(name);

    // Pull names from active shifts log and from uploaded weekly schedule.
    const { data: shifts, error } = await supabase
      .from("shifts")
      .select("staff_name");

    if (error) {
      toast.error("Vardiya kontrol edilemedi");
      return null;
    }

    const schedulePayload = await loadSchedulePayload();
    const candidateNames = [
      ...(shifts || []).map((item) => stripShiftNameSuffix(item.staff_name || "")),
      ...schedulePayload.employees.map((employee) => stripShiftNameSuffix(employee.name || "")),
    ];

    const matchedName = candidateNames.find(
      (staffName) => normalizeFullName(staffName) === normalizedInput
    );

    if (!matchedName) {
      toast.error("Shift üzerinde böyle bir kişi yok");
      return null;
    }

    return matchedName;
  };

  // Check if user exists in users table
  const checkUserExists = async (name: string) => {
    if (useLocalUserStore) {
      const localUsers = readLocalUsers();
      return localUsers.find((item) => item.full_name === name) ?? null;
    }

    const { data: users, error } = await supabase
      .from("users")
      .select("*")
      .eq("full_name", name)
      .limit(1);

    if (error) {
      if (isUsersTableMissing(error.message)) {
        setUseLocalUserStore(true);
        toast.warning("users tablosu bulunamadi. Gecici olarak yerel kayit kullanilacak.");
        const localUsers = readLocalUsers();
        return localUsers.find((item) => item.full_name === name) ?? null;
      }
      console.error("Users table query error:", error);
      toast.error("Kullanıcı kontrol edilemedi: " + (error.message || "Veritabanı hatası"));
      return null;
    }

    if (!users || users.length === 0) {
      return null;
    }

    return users[0];
  };

  // Handle name validation
  const handleNameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!fullName.trim()) {
      toast.error("Ad soyad yazın");
      return;
    }

    setLoading(true);

    try {
      // Check admin first
      const isAdminName = hasAdminCredentials() && isAdminUsername(fullName.trim());
      if (isAdminName) {
        setFullName(fullName.trim());
        setStep("admin-password");
        setLoading(false);
        return;
      }

      // Validate in shifts
      const matchedShiftName = await validateNameInShifts(fullName);
      if (!matchedShiftName) {
        setLoading(false);
        return;
      }

      // Check if user exists in users table
      const existingUser = await checkUserExists(matchedShiftName);

      setFullName(matchedShiftName);
      setFoundUser(existingUser);

      if (existingUser) {
        // Existing user - ask for security number
        setIsFirstLogin(false);
        setStep("existing-security-number");
      } else {
        // First login - ask for notification permission
        setIsFirstLogin(true);
        setStep("notification");
      }
    } finally {
      setLoading(false);
    }
  };

  // Handle admin password
  const handleAdminPasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!isValidAdminPassword(adminPassword)) {
      toast.error("Yönetici şifresi yanlış");
      return;
    }

    setLoading(true);
    localStorage.setItem("userName", fullName);
    localStorage.setItem("userRole", "admin");
    toast.success(`Yönetici girişi başarılı, ${fullName}!`);

    setTimeout(() => {
      navigate("/admin");
      setLoading(false);
    }, 500);
  };

  // Handle notification permission
  const handleNotificationPermission = async (e: React.FormEvent) => {
    e.preventDefault();

    setLoading(true);

    try {
      // Request notification permission
      if ("Notification" in window) {
        if (Notification.permission === "default") {
          const permission = await Notification.requestPermission();
          if (permission !== "granted") {
            toast.warning("Bildirim izni verilmedi (isteğe bağlı)");
          }
        }
      }

      // Move to security number step
      setStep("security-number");
    } finally {
      setLoading(false);
    }
  };

  // Handle first-time security number submission
  const handleFirstTimeSecurityNumber = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isValidSecurityNumber(securityNumber)) {
      toast.error("Sicil numarası 8 haneli ve sadece sayılardan oluşmalı");
      return;
    }

    setLoading(true);

    try {
      if (useLocalUserStore) {
        const localUsers = readLocalUsers();
        const exists = localUsers.some((item) => item.full_name === fullName);
        if (exists) {
          toast.error("Bu ad zaten kayıtlı");
          return;
        }

        localUsers.push({
          id: crypto.randomUUID(),
          full_name: fullName,
          security_number: securityNumber.trim(),
          notification_enabled: Notification.permission === "granted",
          updated_at: new Date().toISOString(),
        });
        writeLocalUsers(localUsers);

        localStorage.setItem("userName", fullName);
        localStorage.setItem("userRole", "staff");
        localStorage.setItem("securityNumber", securityNumber.trim());
        toast.success(`Hoşgeldin, ${fullName}!`);

        setTimeout(() => {
          navigate("/");
          setLoading(false);
        }, 500);
        return;
      }

      // Create user in users table
      const { error } = await supabase.from("users").insert({
        full_name: fullName,
        security_number: securityNumber.trim(),
        notification_enabled: Notification.permission === "granted",
        is_admin: false,
      });

      if (error) {
        if (error.code === "23505") {
          toast.error("Bu ad zaten kayıtlı");
        } else {
          toast.error("Kullanıcı oluşturulamadı: " + error.message);
        }
        return;
      }

      // Save to localStorage
      localStorage.setItem("userName", fullName);
      localStorage.setItem("userRole", "staff");
      localStorage.setItem("securityNumber", securityNumber.trim());
      toast.success(`Hoşgeldin, ${fullName}!`);

      setTimeout(() => {
        navigate("/");
        setLoading(false);
      }, 500);
    } finally {
      setLoading(false);
    }
  };

  // Handle existing user security number
  const handleExistingSecurityNumber = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isValidSecurityNumber(securityNumber)) {
      toast.error("Sicil numarası 8 haneli ve sadece sayılardan oluşmalı");
      return;
    }

    if (securityNumber.trim() !== foundUser.security_number) {
      toast.error("Sicil numarası yanlış");
      return;
    }

    setLoading(true);

    try {
      if (useLocalUserStore) {
        const localUsers = readLocalUsers();
        const nextUsers = localUsers.map((item) =>
          item.full_name === fullName
            ? { ...item, updated_at: new Date().toISOString() }
            : item
        );
        writeLocalUsers(nextUsers);

        localStorage.setItem("userName", fullName);
        localStorage.setItem("userRole", "staff");
        localStorage.setItem("securityNumber", securityNumber.trim());
        toast.success(`Hoşgeldin, ${fullName}!`);

        setTimeout(() => {
          navigate("/");
          setLoading(false);
        }, 500);
        return;
      }

      // Update last login
      await supabase
        .from("users")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", foundUser.id);

      // Save to localStorage
      localStorage.setItem("userName", fullName);
      localStorage.setItem("userRole", "staff");
      localStorage.setItem("securityNumber", securityNumber.trim());
      toast.success(`Hoşgeldin, ${fullName}!`);

      setTimeout(() => {
        navigate("/");
        setLoading(false);
      }, 500);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,hsl(var(--primary))/0.18,transparent_32%),radial-gradient(circle_at_bottom_right,hsl(var(--secondary))/0.24,transparent_28%),linear-gradient(135deg,hsl(var(--background)),hsl(220_28%_10%))]">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-8rem] top-[-6rem] h-64 w-64 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute bottom-[-10rem] right-[-6rem] h-80 w-80 rounded-full bg-sky-400/10 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-6xl items-center justify-center p-4 sm:p-6 lg:p-8">
        <Card className="grid w-full max-w-5xl overflow-hidden border-white/10 bg-card/85 shadow-[0_30px_120px_-32px_rgba(10,18,38,0.78)] backdrop-blur xl:grid-cols-[1.08fr_0.92fr]">
          <div className="relative hidden overflow-hidden border-r border-white/10 bg-[linear-gradient(160deg,rgba(59,130,246,0.18),rgba(15,23,42,0.88)_42%,rgba(14,165,233,0.16))] p-10 xl:flex xl:flex-col xl:justify-between">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/8 px-4 py-1.5 text-xs font-medium uppercase tracking-[0.24em] text-white/80">
                Operasyon Girisi
              </div>
              <div className="space-y-4">
                <h2 className="max-w-md text-4xl font-heading font-semibold leading-tight text-white">
                  Vardiya, hizmet ve bildirim akisina tek ekrandan gir.
                </h2>
                <p className="max-w-lg text-sm leading-6 text-white/72">
                  Personel girisi aktif vardiya kaydiyla kontrol edilir. Ilk giriste sicil numarasi kaydedilir, sonraki girislerde hizli dogrulama ile devam edilir.
                </p>
              </div>
            </div>

            <div className="grid gap-4">
              <div className="rounded-3xl border border-white/10 bg-black/20 p-5 text-left backdrop-blur-sm">
                <p className="text-xs uppercase tracking-[0.24em] text-white/50">Nasil Calisir</p>
                <ul className="mt-4 space-y-3 text-sm text-white/78">
                  <li>Ad soyad vardiya ve yuklu program ile eslestirilir.</li>
                  <li>Ilk giriste bildirim tercihi ve 8 haneli sicil no alinir.</li>
                  <li>Sonraki girisler tek adimda sicil dogrulamasi ile ilerler.</li>
                </ul>
              </div>

              <div className="grid grid-cols-3 gap-3 text-left">
                <div className="rounded-2xl border border-white/10 bg-white/6 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-white/50">Adim 1</p>
                  <p className="mt-2 text-sm font-medium text-white">Ad Soyad</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/6 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-white/50">Adim 2</p>
                  <p className="mt-2 text-sm font-medium text-white">Bildirim</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/6 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-white/50">Adim 3</p>
                  <p className="mt-2 text-sm font-medium text-white">Dogrulama</p>
                </div>
              </div>
            </div>
          </div>

          <div className="p-6 sm:p-8 lg:p-10">
            <div className="mx-auto flex w-full max-w-md flex-col">
              <div className="mb-8 flex items-center justify-between gap-4">
                <img
                  src="/celebi-logo.png"
                  alt="Celebi logo"
                  className="h-14 w-auto object-contain sm:h-16"
                />
                <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
                  <StepIcon className="h-3.5 w-3.5" />
                  {currentStepMeta.label}
                </div>
              </div>

              <div className="mb-8 space-y-3 text-left">
                <h1 className="text-3xl font-heading font-semibold tracking-tight text-foreground sm:text-[2rem]">
                  {currentStepMeta.title}
                </h1>
                <p className="max-w-md text-sm leading-6 text-muted-foreground">
                  {currentStepMeta.description}
                </p>
              </div>

              <div className="rounded-[28px] border border-white/10 bg-background/55 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] sm:p-6">
          {/* Step: Name */}
          {step === "name" && (
            <>
              <form onSubmit={handleNameSubmit} className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground/90">
                    Ad Soyad
                  </label>
                  <Input
                    type="text"
                    placeholder="Örn: Ahmet Yılmaz"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    disabled={loading}
                    autoFocus
                    className="h-11 rounded-xl border-white/10 bg-white/5"
                  />
                </div>

                <Button type="submit" disabled={loading} className="h-11 w-full rounded-xl text-sm font-medium">
                  {loading ? "Kontrol ediliyor..." : "Devam Et"}
                </Button>
              </form>

              <p className="mt-6 text-center text-xs text-muted-foreground">
                Adın işlem geçmişinde görünecek
              </p>
            </>
          )}

          {/* Step: Admin Password */}
          {step === "admin-password" && (
            <>
              <form onSubmit={handleAdminPasswordSubmit} className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground/90">
                    Yönetici Şifresi
                  </label>
                  <Input
                    type="password"
                    placeholder="Şifreyi gir"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    disabled={loading}
                    autoFocus
                    className="h-11 rounded-xl border-white/10 bg-white/5"
                  />
                </div>

                <Button type="submit" disabled={loading} className="h-11 w-full rounded-xl text-sm font-medium">
                  {loading ? "Giriş yapılıyor..." : "Giriş Yap"}
                </Button>
              </form>

              <button
                onClick={resetToNameStep}
                className="mt-6 inline-flex w-full items-center justify-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Geri dön
              </button>
            </>
          )}

          {/* Step: Notification Permission */}
          {step === "notification" && (
            <>
              <form onSubmit={handleNotificationPermission} className="space-y-4">
                <div className="rounded-2xl border border-dashed border-primary/25 bg-primary/5 p-5 text-center">
                  <Bell className="mx-auto mb-3 h-9 w-9 text-primary" />
                  <p className="text-sm leading-6 text-muted-foreground">
                    Uçuş ve hizmet bildirimleri alacaksın
                  </p>
                </div>

                <Button type="submit" disabled={loading} className="h-11 w-full rounded-xl text-sm font-medium">
                  {loading ? "Hazırlanıyor..." : "İzin Ver ve Devam Et"}
                </Button>

                <button
                  type="button"
                  onClick={() => setStep("security-number")}
                  className="w-full text-center text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  Şimdi vermiyorum
                </button>
              </form>
            </>
          )}

          {/* Step: First-time Security Number */}
          {step === "security-number" && isFirstLogin && (
            <>
              <form onSubmit={handleFirstTimeSecurityNumber} className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground/90">
                    Sicil Numarası
                  </label>
                  <Input
                    type="text"
                    placeholder="Örn: 47025577"
                    value={securityNumber}
                    onChange={(e) => setSecurityNumber(sanitizeSecurityNumber(e.target.value))}
                    disabled={loading}
                    autoFocus
                    maxLength={8}
                    inputMode="numeric"
                    pattern="[0-9]{8}"
                    className="h-11 rounded-xl border-white/10 bg-white/5"
                  />
                </div>

                <Button type="submit" disabled={loading} className="h-11 w-full rounded-xl text-sm font-medium">
                  {loading ? "Kaydediliyor..." : "Tamamla"}
                </Button>
              </form>
            </>
          )}

          {/* Step: Existing User Security Number */}
          {step === "existing-security-number" && !isFirstLogin && (
            <>
              <form onSubmit={handleExistingSecurityNumber} className="space-y-4">
                <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 text-center">
                  <p className="text-sm font-medium">{fullName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Sicil numaranı doğrula
                  </p>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground/90">
                    Sicil Numarası
                  </label>
                  <Input
                    type="password"
                    placeholder="8 haneli sicil no"
                    value={securityNumber}
                    onChange={(e) => setSecurityNumber(sanitizeSecurityNumber(e.target.value))}
                    disabled={loading}
                    autoFocus
                    maxLength={8}
                    inputMode="numeric"
                    pattern="[0-9]{8}"
                    className="h-11 rounded-xl border-white/10 bg-white/5"
                  />
                </div>

                <Button type="submit" disabled={loading} className="h-11 w-full rounded-xl text-sm font-medium">
                  {loading ? "Kontrol ediliyor..." : "Giriş Yap"}
                </Button>
              </form>

              <button
                onClick={resetToNameStep}
                className="mt-6 inline-flex w-full items-center justify-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Geri dön
              </button>
            </>
          )}
              </div>

              <p className="mt-6 text-center text-xs leading-5 text-muted-foreground">
                Giris sonrasi yapilan islemler kullanici adi ile kaydedilir. Sorun yasarsan admin ekibi ile iletisime gec.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default Login;

