import { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Phone, Search, User, Building2, ChevronDown, ChevronRight, Loader2, PlusCircle, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type Contact = {
  name: string;
  position: string;
  phone: string;
  team: string;
};

type PersonnelRow = { name: string; team: string };

function parseDirectoryCsv(text: string): Omit<Contact, "team">[] {
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

function parsePersonnelCsv(text: string): PersonnelRow[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  return lines.slice(1).map((line) => {
    const parts = line.split(",");
    return {
      name: (parts[0] ?? "").trim(),
      team: (parts[1] ?? "").trim(),
    };
  });
}

// Palette cycling for team badges
const PALETTE = [
  "bg-sky-500/15 text-sky-400 border-sky-500/30",
  "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  "bg-violet-500/15 text-violet-400 border-violet-500/30",
  "bg-amber-500/15 text-amber-400 border-amber-500/30",
  "bg-rose-500/15 text-rose-400 border-rose-500/30",
  "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  "bg-orange-500/15 text-orange-400 border-orange-500/30",
  "bg-teal-500/15 text-teal-400 border-teal-500/30",
];

const STORAGE_KEY = "celebi_added_phones";

const DirectoryPage = () => {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsedDepts, setCollapsedDepts] = useState<Set<string>>(new Set());
  // manually added phones: name -> phone
  const [addedPhones, setAddedPhones] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}"); } catch { return {}; }
  });
  // inline editing state: which contact is being edited
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([
      fetch("/directory.csv").then((r) => r.text()),
      fetch("/personnel.csv").then((r) => r.text()),
    ])
      .then(([dirText, perText]) => {
        const dirContacts = parseDirectoryCsv(dirText);
        const personnel = parsePersonnelCsv(perText);
        // Build lookup: UPPERCASE name -> team
        const teamMap = new Map<string, string>();
        for (const p of personnel) {
          teamMap.set(p.name.toUpperCase(), p.team || "Diğer");
        }
        // Only keep contacts that exist in the shift schedule
        const merged: Contact[] = [];
        for (const c of dirContacts) {
          const team = teamMap.get(c.name.toUpperCase());
          if (team !== undefined) {
            merged.push({ ...c, team });
          }
        }
        // Also add personnel not in directory.csv (no phone, no position)
        for (const p of personnel) {
          const nameUp = p.name.toUpperCase();
          const alreadyIn = merged.some((m) => m.name.toUpperCase() === nameUp);
          if (!alreadyIn) {
            merged.push({ name: p.name, position: "", phone: "", team: p.team || "Diğer" });
          }
        }
        merged.sort((a, b) => a.name.localeCompare(b.name, "tr"));
        setContacts(merged);
      })
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
        c.team.toLowerCase().includes(q) ||
        c.phone.includes(q),
    );
  }, [query, contacts]);

  // Group by team from personnel.csv
  const grouped = useMemo(() => {
    const map = new Map<string, Contact[]>();
    for (const c of filtered) {
      const arr = map.get(c.team) ?? [];
      arr.push(c);
      map.set(c.team, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, "tr"));
  }, [filtered]);

  // Assign consistent color per team name
  const teamColorMap = useMemo(() => {
    const map = new Map<string, string>();
    const teams = Array.from(new Set(contacts.map((c) => c.team))).sort((a, b) => a.localeCompare(b, "tr"));
    teams.forEach((t, i) => map.set(t, PALETTE[i % PALETTE.length]));
    return map;
  }, [contacts]);

  const toggleDept = (dept: string) => {
    setCollapsedDepts((prev) => {
      const next = new Set(prev);
      next.has(dept) ? next.delete(dept) : next.add(dept);
      return next;
    });
  };

  const startEdit = (name: string, current: string) => {
    setEditingName(name);
    setEditValue(current);
    setTimeout(() => editInputRef.current?.focus(), 50);
  };

  const saveEdit = (name: string) => {
    const val = editValue.trim();
    const updated = { ...addedPhones, [name]: val };
    if (!val) delete updated[name];
    setAddedPhones(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    setEditingName(null);
  };

  const cancelEdit = () => setEditingName(null);

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
          </span>        </div>
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
          grouped.map(([team, teamContacts]) => {
            const isCollapsed = collapsedDepts.has(team);
            const colorClass = teamColorMap.get(team) ?? "bg-zinc-500/15 text-zinc-400 border-zinc-500/30";
            return (
              <section key={team} className="rounded-2xl border border-border bg-card/60 overflow-hidden">
                <button
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors"
                  onClick={() => toggleDept(team)}
                >
                  <Badge variant="outline" className={`text-xs shrink-0 ${colorClass}`}>
                    {team}
                  </Badge>
                  <span className="text-xs text-muted-foreground ml-auto">{teamContacts.length} kişi</span>
                  {isCollapsed ? (
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                  )}
                </button>

                {!isCollapsed && (
                  <div className="divide-y divide-border/60">
                    {teamContacts.map((contact, idx) => {
                      const effectivePhone = contact.phone || addedPhones[contact.name] || "";
                      const isEditing = editingName === contact.name;
                      return (
                      <div key={idx} className="flex items-center gap-3 px-4 py-3.5">
                        <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                          <span className="text-sm font-semibold text-primary">
                            {contact.name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate leading-tight">{contact.name}</p>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">{contact.position || <span className="italic opacity-50">—</span>}</p>
                        </div>

                        {/* Phone area */}
                        {isEditing ? (
                          <div className="flex items-center gap-1 shrink-0">
                            <input
                              ref={editInputRef}
                              type="tel"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") saveEdit(contact.name); if (e.key === "Escape") cancelEdit(); }}
                              className="w-36 text-xs font-mono rounded-lg border border-primary/40 bg-background/80 px-2 py-1.5 outline-none focus:border-primary"
                              placeholder="05XX XXX XX XX"
                            />
                            <button onClick={() => saveEdit(contact.name)} className="p-1.5 rounded-lg text-emerald-400 hover:bg-emerald-500/10">
                              <Check className="w-4 h-4" />
                            </button>
                            <button onClick={cancelEdit} className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/10">
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : effectivePhone ? (
                          <div className="flex items-center gap-1 shrink-0">
                            <a
                              href={`tel:${effectivePhone}`}
                              className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/25 hover:bg-emerald-500/20 active:scale-95 transition-all px-3 py-2"
                              aria-label={`${contact.name} ara`}
                            >
                              <Phone className="w-4 h-4 text-emerald-400" />
                              <span className="text-xs font-mono text-emerald-400 hidden sm:inline">{effectivePhone}</span>
                            </a>
                            {/* Edit button for manually added phones */}
                            {!contact.phone && (
                              <button onClick={() => startEdit(contact.name, effectivePhone)} className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted/60" title="Düzenle">
                                <PlusCircle className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        ) : (
                          <button
                            onClick={() => startEdit(contact.name, "")}
                            className="flex items-center gap-1.5 rounded-xl border border-dashed border-border hover:border-primary/50 hover:bg-primary/5 text-muted-foreground hover:text-primary transition-all px-3 py-2 shrink-0"
                          >
                            <PlusCircle className="w-4 h-4" />
                            <span className="text-xs hidden sm:inline">Numara ekle</span>
                          </button>
                        )}
                      </div>
                      );
                    })}
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
