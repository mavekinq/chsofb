import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Phone, Search, User, Building2, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type Contact = {
  name: string;
  position: string;
  phone: string;
};

function parseCsv(text: string): Contact[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  return lines.slice(1).map((line) => {
    const parts = line.split(",");
    return {
      name: (parts[0] ?? "").trim(),
      position: (parts[1] ?? "").trim(),
      phone: (parts[2] ?? "").trim(),
    };
  });
}

function getDepartment(position: string): string {
  const p = position.toLowerCase();
  if (p.includes("müdür") || p.includes("direktör") || p.includes("koordinatör")) return "Yönetim";
  if (p.includes("şef")) return "Şefler";
  if (p.includes("memur")) return "Memurlar";
  if (p.includes("özel hizmet") || p.includes("wheelchair") || p.includes("erişilebilir")) return "Özel Hizmetler";
  if (p.includes("işçi") || p.includes("kontuar")) return "Saha Personeli";
  return "Diğer";
}

const DEPT_ORDER = ["Yönetim", "Şefler", "Memurlar", "Özel Hizmetler", "Saha Personeli", "Diğer"];

const deptColor: Record<string, string> = {
  Yönetim: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  Şefler: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  Memurlar: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  "Özel Hizmetler": "bg-rose-500/15 text-rose-400 border-rose-500/30",
  "Saha Personeli": "bg-amber-500/15 text-amber-400 border-amber-500/30",
  Diğer: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
};

const DirectoryPage = () => {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsedDepts, setCollapsedDepts] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/directory.csv")
      .then((r) => r.text())
      .then((text) => setContacts(parseCsv(text)))
      .catch(() => setContacts([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.position.toLowerCase().includes(q) ||
        c.phone.includes(q),
    );
  }, [query, contacts]);

  const grouped = useMemo(() => {
    const map = new Map<string, Contact[]>();
    for (const c of filtered) {
      const dept = getDepartment(c.position);
      const arr = map.get(dept) ?? [];
      arr.push(c);
      map.set(dept, arr);
    }
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
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-30">
        <div className="container h-14 px-4 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")} className="shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-2 min-w-0">
            <Building2 className="w-5 h-5 text-primary shrink-0" />
            <h1 className="font-heading font-semibold text-lg truncate">Çelebi Rehber</h1>
          </div>
          <span className="ml-auto text-xs text-muted-foreground shrink-0">
            {loading ? "Yükleniyor..." : `${contacts.length} kişi`}
          </span>
        </div>
      </header>

      <main className="container px-4 py-5 space-y-4 max-w-2xl">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-9 h-11 text-base bg-card/70 border-border focus-visible:ring-primary"
            placeholder="İsim, unvan veya numara ara..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
          />
        </div>

        {loading && (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && grouped.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <User className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Aramanızla eşleşen kişi bulunamadı.</p>
          </div>
        )}

        {!loading &&
          grouped.map(([dept, deptContacts]) => {
            const isCollapsed = collapsedDepts.has(dept);
            const colorClass = deptColor[dept] ?? "bg-zinc-500/15 text-zinc-400 border-zinc-500/30";
            return (
              <section key={dept} className="rounded-2xl border border-border bg-card/60 overflow-hidden">
                <button
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors"
                  onClick={() => toggleDept(dept)}
                >
                  <Badge variant="outline" className={`text-xs shrink-0 ${colorClass}`}>
                    {dept}
                  </Badge>
                  <span className="text-xs text-muted-foreground ml-auto">{deptContacts.length} kişi</span>
                  {isCollapsed ? (
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                  )}
                </button>

                {!isCollapsed && (
                  <div className="divide-y divide-border/60">
                    {deptContacts.map((contact, idx) => (
                      <div key={idx} className="flex items-center gap-3 px-4 py-3.5">
                        <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                          <span className="text-sm font-semibold text-primary">
                            {contact.name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate leading-tight">{contact.name}</p>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">{contact.position}</p>
                        </div>
                        {contact.phone ? (
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
                        ) : (
                          <span className="text-xs text-muted-foreground/50 px-3 py-2 shrink-0">—</span>
                        )}
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
