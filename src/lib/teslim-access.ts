const TESLIM_SECURITY_NUMBER = "47024988";

const normalizeSecurityNumber = (value: string | null | undefined) =>
  (value || "").replace(/\D/g, "");

export const hasTeslimAccess = (
  securityNumber: string | null | undefined,
  role: string | null | undefined,
) =>
  role === "admin" ||
  normalizeSecurityNumber(securityNumber) === TESLIM_SECURITY_NUMBER;

export const getTeslimSecurityNumber = () => TESLIM_SECURITY_NUMBER;
