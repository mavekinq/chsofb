import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Bell, Save, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import {
  ensurePushSubscription,
  getNotificationPreferences,
  saveNotificationPreferences,
  type NotificationPreferences,
} from "@/lib/notifications";

type StoredStaffUser = {
  id: string;
  full_name: string;
  security_number: string;
  notification_enabled: boolean;
  updated_at: string;
};

type AuthUserRecord = {
  id: string;
  full_name: string;
  security_number: string;
  notification_enabled: boolean;
};

const LOCAL_USERS_KEY = "staffAuthUsers";

const readLocalUsers = (): StoredStaffUser[] => {
  try {
    const raw = localStorage.getItem(LOCAL_USERS_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as StoredStaffUser[];
    return Array.isArray(parsed) ? parsed : [];
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

const SettingsPage = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [useLocalUserStore, setUseLocalUserStore] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState("");

  const [fullName, setFullName] = useState("");
  const [securityNumber, setSecurityNumber] = useState("");
  const [notificationEnabled, setNotificationEnabled] = useState(true);
  const [preferences, setPreferences] = useState<NotificationPreferences>(() => getNotificationPreferences());

  useEffect(() => {
    const bootstrap = async () => {
      const storedUserName = localStorage.getItem("userName") || "";
      const storedRole = localStorage.getItem("userRole") || "staff";

      if (!storedUserName) {
        navigate("/login");
        return;
      }

      setCurrentUserName(storedUserName);
      setFullName(storedUserName);
      setSecurityNumber(localStorage.getItem("securityNumber") || "");

      if (storedRole === "admin") {
        setLoading(false);
        return;
      }

      const { data: users, error } = await supabase
        .from("users")
        .select("id, full_name, security_number, notification_enabled")
        .eq("full_name", storedUserName)
        .limit(1);

      if (error) {
        if (isUsersTableMissing(error.message)) {
          setUseLocalUserStore(true);
          const localUser = readLocalUsers().find((item) => item.full_name === storedUserName);
          if (localUser) {
            setUserId(localUser.id);
            setFullName(localUser.full_name);
            setSecurityNumber(localUser.security_number || "");
            setNotificationEnabled(Boolean(localUser.notification_enabled));
          }
          setLoading(false);
          return;
        }

        toast.error("Kullanici ayarlari yuklenemedi");
        setLoading(false);
        return;
      }

      const dbUser = (users?.[0] || null) as AuthUserRecord | null;
      if (dbUser) {
        setUserId(dbUser.id);
        setFullName(dbUser.full_name);
        setSecurityNumber(dbUser.security_number || "");
        setNotificationEnabled(Boolean(dbUser.notification_enabled));
      }

      setLoading(false);
    };

    void bootstrap();
  }, [navigate]);

  const handleSave = async () => {
    const nextFullName = currentUserName;
    const nextSecurityNumber = securityNumber.trim();

    if (nextSecurityNumber && !isValidSecurityNumber(nextSecurityNumber)) {
      toast.error("Sicil numarasi 8 haneli olmali");
      return;
    }

    setSaving(true);

    try {
      if (notificationEnabled) {
        await ensurePushSubscription(nextFullName);
      }

      if (useLocalUserStore) {
        const users = readLocalUsers();
        const nextUsers = users.map((item) => {
          if (item.full_name !== currentUserName) {
            return item;
          }

          return {
            ...item,
            full_name: nextFullName,
            security_number: nextSecurityNumber,
            notification_enabled: notificationEnabled,
            updated_at: new Date().toISOString(),
          };
        });
        writeLocalUsers(nextUsers);
      } else {
        const payload = {
          security_number: nextSecurityNumber || null,
          notification_enabled: notificationEnabled,
          updated_at: new Date().toISOString(),
        };

        if (userId) {
          const { error } = await supabase.from("users").update(payload).eq("id", userId);
          if (error) {
            toast.error(`Ayarlar kaydedilemedi: ${error.message}`);
            return;
          }
        } else {
          const { data, error } = await supabase
            .from("users")
            .insert({ ...payload, full_name: nextFullName, is_admin: false })
            .select("id")
            .single();

          if (error) {
            toast.error(`Ayarlar kaydedilemedi: ${error.message}`);
            return;
          }

          setUserId(data.id);
        }
      }

      saveNotificationPreferences(preferences);
      if (nextSecurityNumber) {
        localStorage.setItem("securityNumber", nextSecurityNumber);
      } else {
        localStorage.removeItem("securityNumber");
      }
      toast.success("Ayarlar kaydedildi");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">Yukleniyor...</div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-30">
        <div className="container h-14 px-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <h1 className="font-heading font-semibold text-lg">Ayarlar</h1>
          </div>
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            <Save className="w-4 h-4" />
            {saving ? "Kaydediliyor..." : "Kaydet"}
          </Button>
        </div>
      </header>

      <main className="container px-4 py-6 space-y-4 max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserRound className="w-4 h-4" />
              Profil Bilgileri
            </CardTitle>
            <CardDescription>Ad soyad ve sicil bilgini guncelleyebilirsin.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="settings-full-name">Ad Soyad</Label>
              <Input
                id="settings-full-name"
                value={fullName}
                disabled
                readOnly
              />
              <p className="text-xs text-muted-foreground">Ad soyad giris kaydina bagli oldugu icin degistirilemez.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="settings-security-number">Sicil Numarasi</Label>
              <Input
                id="settings-security-number"
                value={securityNumber}
                onChange={(event) => setSecurityNumber(sanitizeSecurityNumber(event.target.value))}
                placeholder="8 haneli sicil"
                maxLength={8}
                inputMode="numeric"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="w-4 h-4" />
              Bildirim Tercihleri
            </CardTitle>
            <CardDescription>Hangi bildirimleri almak istedigini sec.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-medium text-sm">Push Bildirimleri</p>
                <p className="text-xs text-muted-foreground">Tarayici/PWA push bildirimlerini ac veya kapat.</p>
              </div>
              <Switch checked={notificationEnabled} onCheckedChange={setNotificationEnabled} />
            </div>

            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-medium text-sm">Yeni Hizmet Uyarilari</p>
                <p className="text-xs text-muted-foreground">Canli hizmet popup ve bildirimlerini goster.</p>
              </div>
              <Switch
                checked={preferences.serviceAlertsEnabled}
                onCheckedChange={(checked) => setPreferences((prev) => ({ ...prev, serviceAlertsEnabled: checked }))}
              />
            </div>

            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-medium text-sm">Ekran Acikken Toast Goster</p>
                <p className="text-xs text-muted-foreground">Uygulama acikken ustte kisa bildirim gosterir.</p>
              </div>
              <Switch
                checked={preferences.serviceToastEnabled}
                disabled={!preferences.serviceAlertsEnabled}
                onCheckedChange={(checked) => setPreferences((prev) => ({ ...prev, serviceToastEnabled: checked }))}
              />
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default SettingsPage;