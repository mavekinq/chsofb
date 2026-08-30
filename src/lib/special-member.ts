const SPECIAL_MEMBER_SECURITY_NUMBER = "47013924";

const normalizeSecurityNumber = (value: string | null | undefined) =>
  (value || "").replace(/\D/g, "");

export const hasSpecialMemberAccess = (securityNumber: string | null | undefined) => {
  return normalizeSecurityNumber(securityNumber) === SPECIAL_MEMBER_SECURITY_NUMBER;
};

export const getSpecialMemberSecurityNumber = () => SPECIAL_MEMBER_SECURITY_NUMBER;