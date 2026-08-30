import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ShieldCheck, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { hasSpecialMemberAccess } from "@/lib/special-member";

const SpecialMemberPage = () => {
  const navigate = useNavigate();
  const currentUser = localStorage.getItem("userName") || "";
  const securityNumber = localStorage.getItem("securityNumber");
  const hasAccess = useMemo(() => hasSpecialMemberAccess(securityNumber), [securityNumber]);

  useEffect(() => {
    if (!currentUser) {
      navigate("/login");
      return;
    }

    if (!hasAccess) {
      navigate("/");
    }
  }, [currentUser, hasAccess, navigate]);

  if (!currentUser || !hasAccess) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-30">
        <div className="container h-14 px-4 flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <h1 className="font-heading font-semibold text-lg">Ozel Sekme</h1>
        </div>
      </header>

      <main className="container max-w-3xl px-4 py-6 space-y-4">
        <Card className="border-amber-500/30 bg-[linear-gradient(135deg,hsl(var(--card))_0%,hsl(42_85%_65%/0.12)_100%)]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Star className="w-5 h-5 text-amber-400" />
              Size Ozel Alan
            </CardTitle>
            <CardDescription>Bu ekran sadece tanimli sicil numarasina sahip uye icin gorunur.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border border-border bg-secondary/30 p-4">
              <p className="text-sm text-muted-foreground">Aktif kullanici</p>
              <p className="mt-1 font-heading text-2xl">{currentUser}</p>
            </div>

            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-400" />
                <div>
                  <p className="font-medium">Yetki dogrulandi</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Bu sekme security number eslesmesi ile korunuyor. Istersen bir sonraki adimda buraya sana ozel icerik,
                    duyuru, form veya rapor ekleyebilirim.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default SpecialMemberPage;