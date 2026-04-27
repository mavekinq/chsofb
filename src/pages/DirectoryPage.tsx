import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Phone, Search, User, Building2, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

// ── Rehber verisi ─────────────────────────────────────────────
// Bu listeye yeni kişi eklemek için aşağıdaki formatta giriş yapın:
// { name: "Ad Soyad", title: "Unvan", phone: "05XXXXXXXXX", department: "Departman Adı" }

type Contact = {
  name: string;
  title: string;
  phone: string;
  department: string;
};

const CONTACTS: Contact[] = [
  // ── Operasyon ──────────────────────────────────────
  { name: "Örnek Kişi 1", title: "Operasyon Şefi", phone: "05001234567", department: "Operasyon" },
  { name: "Örnek Kişi 2", title: "Vardiya Amiri", phone: "05001234568", department: "Operasyon" },
  { name: "Örnek Kişi 3", title: "Saha Görevlisi", phone: "05001234569", department: "Operasyon" },

  // ── Özel Hizmetler ────────────────────────────────
  { name: "Örnek Kişi 4", title: "Özel Hizmet Sorumlusu", phone: "05009876543", department: "Özel Hizmetler" },
  { name: "Örnek Kişi 5", title: "Tekerlekli Sandalye Koordinatörü", phone: "05009876544", department: "Özel Hizmetler" },

  // ── Yönetim ───────────────────────────────────────
  { name: "Örnek Kişi 6", title: "Operasyon Müdürü", phone: "05005556677", department: "Yönetim" },
  { name: "Örnek Kişi 7", title: "İnsan Kaynakları", phone: "05005556678", department: "Yönetim" },
];

// Departman sıralama önceliği
const DEPT_ORDER = ["Yönetim", "Operasyon", "Özel Hizmetler"];

const deptColor: Record<string, string> = {
  "Yönetim": "bg-violet-500/15 text-violet-400 border-violet-500/30",
  "Operasyon": "bg-sky-500/15 text-sky-400 border-sky-500/30",
  "Özel Hizmetler": "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
};

const defaultDeptColor = "bg-amber-500/15 text-amber-400 border-amber-500/30";

// ── Bileşen ───────────────────────────────────────────────────
const DirectoryPage = () => {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [collapsedDepts, setCollapsedDepts] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CONTACTS;
    return CONTACTS.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.title.toLowerCase().includes(q) ||
        c.department.toLowerCase().includes(q) ||
        c.phone.includes(q),
    );
  }, [query]);

  // Departmanlara göre grupla
  const grouped = useMemo(() => {
    const map = new Map<string, Contact[]>();
    for (const c of filtered) {
      const arr = map.get(c.department) ?? [];
      arr.push(c);
      map.set(c.department, arr);
    }
    // Sıralama: önce DEPT_ORDER listesi, sonra alfabetik
    return Array.from(map.entries()).sort(([a], [b]) => {
      const ia = DEPT_ORDER.indexOf(a);
      const ib = DEPT_ORDER.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b, "tr");
    });
  }, [filtered]);

  const toggleDept = (dept: string) => {
    setCollapsedDepts((prev) => {
      const next = new Set(prev);
      next.has(dept) ? next.delete(dept) : next.add(dept);
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.15),transparent_34%),hsl(var(--background))]">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-30">
        <div className="container h-14 px-4 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")} className="shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-2 min-w-0">
            <Building2 className="w-5 h-5 text-primary shrink-0" />
            <h1 className="font-heading font-semibold text-lg truncate">Çelebi Rehber</h1>
          </div>
          <span className="ml-auto text-xs text-muted-foreground shrink-0">{CONTACTS.length} kişi</span>
        </div>
      </header>

      <main className="container px-4 py-5 space-y-4 max-w-2xl">
        {/* Arama */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-9 h-11 text-base bg-card/70 border-border focus-visible:ring-primary"
            placeholder="İsim, unvan veya departman ara..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
          />
        </div>

        {/* Sonuç yok */}
        {grouped.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <User className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Aramanızla eşleşen kişi bulunamadı.</p>
          </div>
        )}

        {/* Departman grupları */}
        {grouped.map(([dept, contacts]) => {
          const isCollapsed = collapsedDepts.has(dept);
          const colorClass = deptColor[dept] ?? defaultDeptColor;
          return (
            <section key={dept} className="rounded-2xl border border-border bg-card/60 overflow-hidden">
              {/* Departman başlığı */}
              <button
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors"
                onClick={() => toggleDept(dept)}
              >
                <Badge variant="outline" className={`text-xs shrink-0 ${colorClass}`}>
                  {dept}
                </Badge>
                <span className="text-xs text-muted-foreground ml-auto">{contacts.length} kişi</span>
                {isCollapsed ? (
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                )}
              </button>

              {/* Kişi kartları */}
              {!isCollapsed && (
                <div className="divide-y divide-border/60">
                  {contacts.map((contact, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-3 px-4 py-3.5"
                    >
                      {/* Avatar */}
                      <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                        <span className="text-sm font-semibold text-primary">
                          {contact.name.charAt(0).toUpperCase()}
                        </span>
                      </div>

                      {/* İsim & Unvan */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate leading-tight">{contact.name}</p>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{contact.title}</p>
                      </div>

                      {/* Ara butonu */}
                      <a
                        href={`tel:${contact.phone}`}
                        className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/25 hover:bg-emerald-500/20 active:scale-95 transition-all px-3 py-2 shrink-0"
                        aria-label={`${contact.name} ara`}
                      >
                        <Phone className="w-4 h-4 text-emerald-400" />
                        <span className="text-xs font-mono text-emerald-400 hidden sm:inline">
                          {contact.phone}
                        </span>
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </main>
    </div>
  );
};

export default DirectoryPage;
