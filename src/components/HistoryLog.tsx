import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { History } from "lucide-react";

interface LogEntry {
  id: string;
  wheelchair_id: string;
  action: string;
  details: string;
  performed_by: string;
  created_at: string;
}

const HistoryLog = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLogs = async () => {
      const { data } = await supabase
        .from("action_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (data) setLogs(data as LogEntry[]);
      setLoading(false);
    };
    fetchLogs();

    const channel = supabase
      .channel("action_logs_realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "action_logs" }, (payload) => {
        setLogs((prev) => [payload.new as LogEntry, ...prev].slice(0, 100));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  return (
    <div className="bg-card border border-border rounded-lg">
      <div className="flex items-center gap-2 p-4 border-b border-border">
        <History className="w-5 h-5 text-primary" />
        <h2 className="font-heading font-semibold">İşlem Geçmişi</h2>
      </div>
      <ScrollArea className="h-[60vh]">
        {loading ? (
          <div className="p-8 text-center text-muted-foreground">Yükleniyor...</div>
        ) : logs.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">Henüz işlem yok</div>
        ) : (
          <div className="divide-y divide-border">
            {logs.map((log) => (
              <div key={log.id} className="p-3 text-sm">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-foreground">{log.wheelchair_id}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(log.created_at).toLocaleString("tr-TR")}
                  </span>
                </div>
                <p className="text-muted-foreground text-xs">
                  {log.action} — {log.details} ({log.performed_by})
                </p>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
};

export default HistoryLog;
