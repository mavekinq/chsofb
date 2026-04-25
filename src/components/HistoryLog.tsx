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
    const init = async () => {
      try {
        const { data } = await supabase
          .from("action_logs")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100);

        setLogs(data || []);
      } catch (err) {
        console.error("Error:", err);
        setLogs([]);
      } finally {
        setLoading(false);
      }
    };

    init();
  }, []);

  return (
    <div className="bg-card border border-border rounded-lg">
      <div className="flex items-center gap-2 p-4 border-b border-border">
        <History className="w-5 h-5 text-primary" />
        <h2 className="font-semibold">İşlem Geçmişi</h2>
      </div>
      <ScrollArea className="h-[60vh]">
        {loading ? (
          <div className="p-8 text-center text-muted-foreground">
            Yükleniyor...
          </div>
        ) : logs.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            Henüz işlem yok
          </div>
        ) : (
          <div className="divide-y divide-border">
            {logs.map((log) => (
              <div key={log.id} className="p-4">
                <div className="font-medium">{log.wheelchair_id}</div>
                <div className="text-sm text-muted-foreground">
                  {log.action}
                </div>
                <div className="text-sm">{log.details}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {log.performed_by} •{" "}
                  {new Date(log.created_at).toLocaleString("tr-TR")}
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
};

export default HistoryLog;
