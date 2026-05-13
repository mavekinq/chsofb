import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

const OfflineStatusBanner = () => {
  const [isOnline, setIsOnline] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (isOnline) {
    return null;
  }

  return (
    <div className="fixed inset-x-0 top-0 z-[70] flex justify-center px-3 pt-3 pointer-events-none md:px-4">
      <div className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs font-medium text-amber-700 shadow-lg backdrop-blur">
        <WifiOff className="h-3.5 w-3.5" />
        Çevrimdışı görünüm - son kayıtlı veriler gösteriliyor
      </div>
    </div>
  );
};

export default OfflineStatusBanner;