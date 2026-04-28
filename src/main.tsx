import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { Analytics } from "@vercel/analytics/react";
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

const recoverFromStaleCache = () => {
	const onceKey = "stale-cache-recovered";
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
			const url = new URL(window.location.href);
			url.searchParams.set("cachebust", String(Date.now()));
			window.location.replace(url.toString());
		}
	})();
};

window.addEventListener("vite:preloadError", recoverFromStaleCache);

window.addEventListener("error", (event) => {
	const target = event.target as HTMLElement | null;
	if (!target) return;

	if (target instanceof HTMLLinkElement && target.rel === "stylesheet") {
		recoverFromStaleCache();
	}

	if (target instanceof HTMLScriptElement) {
		recoverFromStaleCache();
	}
}, true);

window.addEventListener("unhandledrejection", (event) => {
	const message = String((event.reason as Error | undefined)?.message || event.reason || "");
	if (message.includes("Failed to fetch dynamically imported module") || message.includes("Importing a module script failed")) {
		recoverFromStaleCache();
	}
});

createRoot(document.getElementById("root")!).render(
	<>
		<App />
		<Analytics />
	</>,
);
