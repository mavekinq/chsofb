import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import "./index.css";

const updateSW = registerSW({
	immediate: true,
	onNeedRefresh() {
		// Force service worker refresh so stale cached chunks do not cause white screen.
		void updateSW(true);
	},
	onOfflineReady() {
		// no-op
	},
});

window.addEventListener("vite:preloadError", () => {
	// Recover from stale chunk references after a new deploy.
	window.location.reload();
});

createRoot(document.getElementById("root")!).render(<App />);
