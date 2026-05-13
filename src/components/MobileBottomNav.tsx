import { Accessibility, House, Plane, Settings, Users } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

type MobileNavItem = {
  path: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
};

const NAV_ITEMS: MobileNavItem[] = [
  { path: "/", label: "Ana", icon: House, exact: true },
  { path: "/wheelchair-system", label: "Sandalye", icon: Accessibility },
  { path: "/wheelchair-services", label: "Hizmet", icon: Users },
  { path: "/flights", label: "Uçuş", icon: Plane },
  { path: "/settings", label: "Ayarlar", icon: Settings },
];

const VISIBLE_PATHS = [
  "/",
  "/wheelchair-system",
  "/wheelchair-services",
  "/flights",
  "/work-schedule",
  "/directory",
  "/settings",
];

const isVisiblePath = (pathname: string) => {
  if (pathname === "/") {
    return true;
  }

  return VISIBLE_PATHS.some((path) => path !== "/" && pathname.startsWith(path));
};

const isActiveItem = (pathname: string, item: MobileNavItem) => {
  if (item.exact) {
    return pathname === item.path;
  }

  return pathname.startsWith(item.path);
};

const MobileBottomNav = () => {
  const navigate = useNavigate();
  const location = useLocation();

  if (!isVisiblePath(location.pathname)) {
    return null;
  }

  return (
    <>
      <div className="h-20 md:hidden" aria-hidden="true" />
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/90">
        <div className="mx-auto max-w-3xl px-2 pt-1 pb-[calc(0.25rem+env(safe-area-inset-bottom))] grid grid-cols-5 gap-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = isActiveItem(location.pathname, item);

            return (
              <button
                key={item.path}
                type="button"
                onClick={() => navigate(item.path)}
                className={cn(
                  "flex min-w-0 flex-col items-center justify-center rounded-xl px-1 py-1.5 text-[11px] font-medium transition-colors",
                  isActive
                    ? "text-primary bg-primary/10"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/70",
                )}
                aria-label={item.label}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon className="h-4 w-4 mb-0.5" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
};

export default MobileBottomNav;