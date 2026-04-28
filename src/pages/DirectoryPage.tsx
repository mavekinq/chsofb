import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Building2, Check, ChevronDown, ChevronRight, Loader2, Phone, PlusCircle, Search, User, X } from "lucide-react";
import * as XLSX from "xlsx";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

type PersonnelRow = {
  name: string;
  team: string;
  phone: string;
};

const SHIFT_FILES = ["/shifts/week16.xlsx", "/shifts/week17.xlsx", "/shifts/week18.xlsx"];
const DIRECTORY_FILE = "/rehber.xlsx";

const TEAM_REGEX = /Team:\s*\d+\s*-\s*(.+)/i;
const SUFFIX_REGEX = /\s*-\s*[A-Z0-9ÇĞİÖŞÜÇĞİÖŞÜ]+B?\s*$/u;

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

function parseShiftWorkbook(arrayBuffer: ArrayBuffer): PersonnelRow[] {
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];

  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<(string | null)[]>(sheet, { header: 1, raw: false });

  const parsed: PersonnelRow[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    const rawName = rows[i]?.[0];
    const rawGroup = rows[i]?.[1];

    if (typeof rawName !== "string") continue;

    const name = rawName.replace(SUFFIX_REGEX, "").trim();
    if (!name || name.toUpperCase() === "YOLCU HİZMETLERİ") continue;

    let team = "Diğer";
    if (typeof rawGroup === "string") {
      const match = rawGroup.match(TEAM_REGEX);
      if (match?.[1]?.trim()) {
        team = match[1].trim();
      }
    }

    parsed.push({ name, team, phone: "" });
  }

  return parsed;
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .trim();
}

function looksLikePhone(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.includes("@")) return false;
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 10;
}

function parseDirectoryWorkbook(arrayBuffer: ArrayBuffer): Map<string, string> {
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const result = new Map<string, { score: number; phone: string }>();

  const commPriority: Record<string, number> = {
    "sirket cep telefonu": 100,
    "ozel cep telefonu": 90,
    "sirket telefonu": 80,
    "sirket dahili no": 70,
    "sirket cep telefonu kisa kod": 60,
  };

  const pickBestPhone = (values: string[], commRaw: string): { phone: string; score: number } | null => {
    const valid = values
      .map((v) => v.trim())
      .filter((v) => looksLikePhone(v));

    if (valid.length === 0) return null;

    // Prefer mobile-looking values first (longer digits), then keep first occurrence.
    const phone = valid.sort((a, b) => b.replace(/\D/g, "").length - a.replace(/\D/g, "").length)[0];
    const digits = phone.replace(/\D/g, "").length;
    let score = commPriority[commRaw] ?? 50;

    if (digits >= 10) score += 20;
    else if (digits >= 6) score += 10;
    else score += 3;

    return { phone, score };
  };

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<(string | null)[]>(sheet, { header: 1, raw: false });
    if (rows.length < 2) continue;

    const header = rows[0].map((v) => normalize(String(v ?? "")));
    const isHeaderSheet = header.some((h) => h.includes("personel numarasi"));

    const nameIdx = isHeaderSheet ? header.findIndex((h) => h.includes("personel numarasi")) : 1;
    const commIdx = isHeaderSheet ? header.findIndex((h) => h.includes("iletisim turu")) : 6;
    const systemIdx = isHeaderSheet ? header.findIndex((h) => h.includes("sistem taniticisi")) : 7;

    const phoneCandidateIndexes = isHeaderSheet
      ? header
          .map((h, idx) => ({ h, idx }))
          .filter(({ h }) =>
            h.includes("uzun tn") ||
            h.includes("telefon") ||
            h.includes("dahili") ||
            h.includes("kisa kod") ||
            h.includes("tn./no"),
          )
          .map(({ idx }) => idx)
      : [7, 8];

    const startRow = isHeaderSheet ? 1 : 0;
    if (nameIdx === -1) continue;

    for (let i = startRow; i < rows.length; i += 1) {
      const row = rows[i] ?? [];
      const nameRaw = String(row[nameIdx] ?? "").trim();
      if (!nameRaw) continue;
      const key = nameRaw.toLocaleUpperCase("tr-TR");

      const commRaw = normalize(String(commIdx >= 0 ? row[commIdx] ?? "" : ""));
      const systemNo = String(systemIdx >= 0 ? row[systemIdx] ?? "" : "").trim();

      const phoneValues = phoneCandidateIndexes
        .map((idx) => String(row[idx] ?? ""))
        .filter(Boolean);

      const primary = pickBestPhone(phoneValues, commRaw);
      const fallback = null;
      const best = primary ?? fallback;

      if (!best) continue;

      const prev = result.get(key);
      if (!prev || best.score > prev.score) {
        result.set(key, { score: best.score, phone: best.phone });
      }
    }
  }

  const phoneMap = new Map<string, string>();
  for (const [key, value] of result.entries()) {
    phoneMap.set(key, value.phone);
  }
  return phoneMap;
}

const DirectoryPage = () => {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [personnel, setPersonnel] = useState<PersonnelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsedTeams, setCollapsedTeams] = useState<Set<string>>(new Set());
  const [manualPhones, setManualPhones] = useState<Record<string, string>>({});
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let isMounted = true;

    const loadFromExcels = async () => {
      try {
        const shiftResponses = await Promise.all(SHIFT_FILES.map((path) => fetch(path)));
        const shiftBuffers = await Promise.all(shiftResponses.map((r) => r.arrayBuffer()));
        const directoryBuffer = await fetch(DIRECTORY_FILE).then((r) => r.arrayBuffer());
        const phoneMap = parseDirectoryWorkbook(directoryBuffer);
        const sharedPhonesResp = await supabase.from("directory_manual_phones").select("name, phone");

        const seen = new Set<string>();
        const merged: PersonnelRow[] = [];

        for (const buffer of shiftBuffers) {
          const currentRows = parseShiftWorkbook(buffer);
          for (const row of currentRows) {
            const key = row.name.toLocaleUpperCase("tr-TR");
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push({
              ...row,
              phone: phoneMap.get(key) ?? "",
            });
          }
        }

        if (isMounted) {
          setPersonnel(merged);

          if (!sharedPhonesResp.error) {
            const manual: Record<string, string> = {};
            for (const row of sharedPhonesResp.data || []) {
              if (row.name && row.phone) {
                manual[row.name] = row.phone;
              }
            }
            setManualPhones(manual);
          }
        }
      } catch {
        if (isMounted) {
          setPersonnel([]);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void loadFromExcels();

    return () => {
      isMounted = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr-TR");
    if (!q) return personnel;
    return personnel.filter((p) => {
      const phone = manualPhones[p.name] || p.phone || "";
      return p.name.toLocaleLowerCase("tr-TR").includes(q) || p.team.toLocaleLowerCase("tr-TR").includes(q) || phone.includes(q);
    });
  }, [query, personnel, manualPhones]);

  const grouped = useMemo(() => {
    const map = new Map<string, PersonnelRow[]>();
    for (const person of filtered) {
      const arr = map.get(person.team) ?? [];
      arr.push(person);
      map.set(person.team, arr);
    }
    // Insertion order is preserved to match shift order.
    return Array.from(map.entries());
  }, [filtered]);

  const teamColorMap = useMemo(() => {
    const map = new Map<string, string>();
    const teams = Array.from(new Set(personnel.map((p) => p.team)));
    teams.forEach((team, index) => {
      map.set(team, PALETTE[index % PALETTE.length]);
    });
    return map;
  }, [personnel]);

  const toggleTeam = (team: string) => {
    setCollapsedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(team)) {
        next.delete(team);
      } else {
        next.add(team);
      }
      return next;
    });
  };

  const startEdit = (name: string, currentPhone: string) => {
    setEditingName(name);
    setEditingValue(currentPhone);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const saveEdit = async (name: string) => {
    const phone = editingValue.trim();
    if (phone) {
      const { error } = await supabase
        .from("directory_manual_phones")
        .upsert({ name, phone }, { onConflict: "name" });

      if (!error) {
        setManualPhones((prev) => ({ ...prev, [name]: phone }));
      }
    } else {
      const { error } = await supabase
        .from("directory_manual_phones")
        .delete()
        .eq("name", name);

      if (!error) {
        setManualPhones((prev) => {
          const next = { ...prev };
          delete next[name];
          return next;
        });
      }
    }

    setEditingName(null);
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.15),transparent_34%),hsl(var(--background))]">
      <header className="sticky top-0 z-30 border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="container flex h-14 items-center gap-3 px-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")} className="shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex items-center gap-2">
            <Building2 className="h-5 w-5 shrink-0 text-primary" />
            <h1 className="truncate font-heading text-lg font-semibold">Çelebi Rehber</h1>
          </div>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            {loading ? "Yükleniyor..." : `${personnel.length} kişi`}
          </span>
        </div>
      </header>

      <main className="container max-w-2xl space-y-4 px-4 py-5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-11 border-border bg-card/70 pl-9 text-base focus-visible:ring-primary"
            placeholder="İsim, ekip veya numara ara..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
          />
        </div>

        {loading && (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && grouped.length === 0 && (
          <div className="py-16 text-center text-muted-foreground">
            <User className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="text-sm">Eşleşen kişi bulunamadı.</p>
          </div>
        )}

        {!loading &&
          grouped.map(([team, members]) => {
            const isCollapsed = collapsedTeams.has(team);
            const color = teamColorMap.get(team) ?? "bg-zinc-500/15 text-zinc-400 border-zinc-500/30";
            return (
              <section key={team} className="overflow-hidden rounded-2xl border border-border bg-card/60">
                <button
                  className="flex w-full items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
                  onClick={() => toggleTeam(team)}
                >
                  <Badge variant="outline" className={`shrink-0 text-xs ${color}`}>
                    {team}
                  </Badge>
                  <span className="ml-auto text-xs text-muted-foreground">{members.length} kişi</span>
                  {isCollapsed ? (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                </button>

                {!isCollapsed && (
                  <div className="divide-y divide-border/60">
                    {members.map((person) => {
                      const phone = manualPhones[person.name] || person.phone || "";
                      const editing = editingName === person.name;
                      return (
                      <div key={person.name} className="flex items-center gap-3 px-4 py-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10">
                          <span className="text-sm font-semibold text-primary">{person.name.charAt(0).toUpperCase()}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{person.name}</p>
                        </div>

                        {editing ? (
                          <div className="flex items-center gap-1 shrink-0">
                            <input
                              ref={inputRef}
                              type="tel"
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveEdit(person.name);
                                if (e.key === "Escape") setEditingName(null);
                              }}
                              className="w-36 rounded-lg border border-primary/40 bg-background/80 px-2 py-1.5 text-xs font-mono outline-none focus:border-primary"
                              placeholder="05XX XXX XX XX"
                            />
                            <button onClick={() => saveEdit(person.name)} className="rounded-lg p-1.5 text-emerald-400 hover:bg-emerald-500/10">
                              <Check className="h-4 w-4" />
                            </button>
                            <button onClick={() => setEditingName(null)} className="rounded-lg p-1.5 text-rose-400 hover:bg-rose-500/10">
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ) : phone ? (
                          <a
                            href={`tel:${phone}`}
                            className="flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 transition-all hover:bg-emerald-500/20 active:scale-95 shrink-0"
                            aria-label={`${person.name} ara`}
                          >
                            <Phone className="h-4 w-4 text-emerald-400" />
                            <span className="hidden text-xs font-mono text-emerald-400 sm:inline">{phone}</span>
                          </a>
                        ) : (
                          <button
                            onClick={() => startEdit(person.name, "")}
                            className="flex items-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-2 text-muted-foreground transition-all hover:border-primary/50 hover:bg-primary/5 hover:text-primary shrink-0"
                          >
                            <PlusCircle className="h-4 w-4" />
                            <span className="hidden text-xs sm:inline">Numara ekle</span>
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
