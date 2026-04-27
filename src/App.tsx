import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import ServiceAlertOverlay from "@/components/ServiceAlertOverlay";
import { TooltipProvider } from "@/components/ui/tooltip";
import ServiceRealtimeListener from "@/components/ServiceRealtimeListener";
import Login from "./pages/Login.tsx";
import AdminControlPage from "./pages/AdminControlPage.tsx";
import MainMenu from "./pages/MainMenu.tsx";
import Index from "./pages/Index.tsx";
import FlightsPage from "./pages/FlightsPage.tsx";
import WheelchairServicesPage from "./pages/WheelchairServicesPage.tsx";
import WorkSchedulePage from "./pages/WorkSchedulePage.tsx";
import DirectoryPage from "./pages/DirectoryPage.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <ServiceAlertOverlay />
      <ServiceRealtimeListener />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/admin" element={<AdminControlPage />} />
          <Route path="/" element={<MainMenu />} />
          <Route path="/wheelchair-system" element={<Index />} />
          <Route path="/flights" element={<FlightsPage />} />
          <Route path="/wheelchair-services" element={<WheelchairServicesPage />} />
          <Route path="/work-schedule" element={<WorkSchedulePage />} />
          <Route path="/directory" element={<DirectoryPage />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
