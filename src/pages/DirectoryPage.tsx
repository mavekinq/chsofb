import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Building2, ChevronDown, ChevronRight, Loader2, Search, User } from "lucide-react";
import * as XLSX from "xlsx";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type PersonnelRow = {
  name: string;
  team: string;
};

const SHIFT_FILES = ["/shifts/week16.xlsx", "/shifts/week17.xlsx", "/shifts/week18.xlsx"];

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

    parsed.push({ name, team });
  }

  return parsed;
}

const DirectoryPage = () => {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [personnel, setPersonnel] = useState<PersonnelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsedTeams, setCollapsedTeams] = useState<Set<string>>(new Set());

  useEffect(() => {
    let isMounted = true;

    const loadFromShiftExcels = async () => {
      try {
        const responses = await Promise.all(SHIFT_FILES.map((path) => fetch(path)));
        const buffers = await Promise.all(responses.map((r) => r.arrayBuffer()));

        const seen = new Set<string>();
        const merged: PersonnelRow[] = [];

        for (const buffer of buffers) {
          const currentRows = parseShiftWorkbook(buffer);
          for (const row of currentRows) {
            const key = row.name.toLocaleUpperCase("tr-TR");
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push(row);
          }
        }

        if (isMounted) {
          setPersonnel(merged);
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

    void loadFromShiftExcels();

    return () => {
      isMounted = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr-TR");
    if (!q) return personnel;
    return personnel.filter((p) => p.name.toLocaleLowerCase("tr-TR").includes(q) || p.team.toLocaleLowerCase("tr-TR").includes(q));
  }, [query, personnel]);

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
            placeholder="İsim veya ekip ara..."
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
                    {members.map((person) => (
                      <div key={person.name} className="flex items-center gap-3 px-4 py-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10">
                          <span className="text-sm font-semibold text-primary">{person.name.charAt(0).toUpperCase()}</span>
                        </div>
                        <p className="truncate text-sm font-medium">{person.name}</p>
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
