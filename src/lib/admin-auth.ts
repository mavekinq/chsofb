const adminUsername = (import.meta.env.VITE_ADMIN_USERNAME || "").trim().toLocaleLowerCase("tr");
const adminPassword = import.meta.env.VITE_ADMIN_PASSWORD || "";

export const isAdminUsername = (value: string) => value.trim().toLocaleLowerCase("tr") === adminUsername;

export const isValidAdminPassword = (value: string) => value === adminPassword;

export const hasAdminCredentials = () => Boolean(adminUsername && adminPassword);