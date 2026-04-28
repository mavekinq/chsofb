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
	const onceKey = "preload-error-recovered";
	if (sessionStorage.getItem(onceKey) === "1") {
		window.location.reload();
		return;
	}

	void (async () => {
		sessionStorage.setItem(onceKey, "1");
		try {
			if ("serviceWorker" in navigator) {
				const regs = await navigator.serviceWorker.getRegistrations();
				await Promise.all(regs.map((reg) => reg.unregister()));
			}
			if ("caches" in window) {
				const keys = await caches.keys();
				await Promise.all(keys.map((key) => caches.delete(key)));
			}
		} finally {
			window.location.reload();
		}
	})();
});

createRoot(document.getElementById("root")!).render(<App />);
