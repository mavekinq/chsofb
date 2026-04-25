import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SERVICE_ALERT_EVENT } from "@/lib/notifications";
import { extractAssignedStaffFromService, getVisibleServiceNotes } from "@/lib/wheelchair-service-utils";

type ServiceAlertPayload = {
  id?: string;
  flight_iata: string;
  wheelchair_id: string;
  passenger_type: string;
  assigned_staff?: string;
  terminal: string;
  created_by: string;
  notes: string;
  created_at: string;
};

type AlertItem = ServiceAlertPayload & {
  alertId: string;
};

const ServiceAlertOverlay = () => {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);

  useEffect(() => {
    const handleAlert = (event: Event) => {
      const customEvent = event as CustomEvent<ServiceAlertPayload>;
      const service = customEvent.detail;
      if (!service) {
        return;
      }

      const alertId = service.id || `${service.flight_iata}-${service.created_at}`;

      setAlerts((prev) => {
        if (prev.some((item) => item.alertId === alertId)) {
          return prev;
        }

        return [{ ...service, alertId }, ...prev].slice(0, 3);
      });

      window.setTimeout(() => {
        setAlerts((prev) => prev.filter((item) => item.alertId !== alertId));
      }, 10000);
    };

    window.addEventListener(SERVICE_ALERT_EVENT, handleAlert as EventListener);

    return () => {
      window.removeEventListener(SERVICE_ALERT_EVENT, handleAlert as EventListener);
    };
  }, []);

  if (alerts.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-x-3 top-3 z-[60] flex flex-col gap-2 md:left-auto md:right-4 md:w-[360px]">
      {alerts.map((alert) => {
        const assignedStaff = extractAssignedStaffFromService(alert) || "Belirtilmedi";
        const visibleNotes = getVisibleServiceNotes(alert.notes);

        return (
          <div key={alert.alertId} className="pointer-events-auto rounded-xl border border-primary/30 bg-background/95 p-4 shadow-lg backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className="mt-0.5 rounded-lg bg-primary/10 p-2 text-primary">
                  <Bell className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Yeni hizmet: {alert.flight_iata}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {alert.wheelchair_id} • {alert.passenger_type} • Atanan: {assignedStaff}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {alert.terminal} • Kaydeden: {alert.created_by}
                  </p>
                  {visibleNotes ? (
                    <p className="text-xs text-muted-foreground mt-1 break-words">Not: {visibleNotes}</p>
                  ) : null}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setAlerts((prev) => prev.filter((item) => item.alertId !== alert.alertId))}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ServiceAlertOverlay;