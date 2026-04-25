import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { showRealtimeServiceAlert } from "@/lib/notifications";
import { extractAssignedStaffFromService, getVisibleServiceNotes } from "@/lib/wheelchair-service-utils";

type WheelchairServiceRow = Database["public"]["Tables"]["wheelchair_services"]["Row"];
const MAX_RECENT_SERVICE_IDS = 100;

const ServiceRealtimeListener = () => {
  const recentServiceIdsRef = useRef<string[]>([]);

  useEffect(() => {
    const channel = supabase
      .channel("wheelchair_services_global_feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "wheelchair_services" },
        (payload) => {
          const service = payload.new as WheelchairServiceRow;
          if (!service?.id || recentServiceIdsRef.current.includes(service.id)) {
            return;
          }

          recentServiceIdsRef.current = [service.id, ...recentServiceIdsRef.current].slice(0, MAX_RECENT_SERVICE_IDS);

          const assignedStaff = extractAssignedStaffFromService(service) || "Belirtilmedi";
          const visibleNotes = getVisibleServiceNotes(service.notes);

          if (document.visibilityState === "visible") {
            toast.success(`Yeni hizmet: ${service.flight_iata}`, {
              description: `${service.wheelchair_id} • ${service.passenger_type} • Atanan: ${assignedStaff}${visibleNotes ? ` • ${visibleNotes}` : ""}`,
            });
          }

          void showRealtimeServiceAlert(service).catch((error) => {
            console.error("Realtime service alert failed:", error);
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return null;
};

export default ServiceRealtimeListener;