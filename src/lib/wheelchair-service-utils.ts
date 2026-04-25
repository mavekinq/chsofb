const ASSIGNED_STAFF_FALLBACK_PREFIX = "__ASSIGNED_STAFF__:";

export const buildServiceNotesWithAssignedStaff = (notes: string, assignedStaff: string) => {
  const normalizedNotes = notes.trim();
  const normalizedStaff = assignedStaff.trim();

  if (!normalizedStaff) {
    return normalizedNotes;
  }

  return normalizedNotes
    ? `${ASSIGNED_STAFF_FALLBACK_PREFIX}${normalizedStaff}\n${normalizedNotes}`
    : `${ASSIGNED_STAFF_FALLBACK_PREFIX}${normalizedStaff}`;
};

export const extractAssignedStaffFromService = (service: { assigned_staff?: string | null; notes?: string | null }) => {
  const directAssignedStaff = service.assigned_staff?.trim();
  if (directAssignedStaff) {
    return directAssignedStaff;
  }

  const notes = service.notes || "";
  if (!notes.startsWith(ASSIGNED_STAFF_FALLBACK_PREFIX)) {
    return "";
  }

  const firstLine = notes.split(/\r?\n/, 1)[0] || "";
  return firstLine.slice(ASSIGNED_STAFF_FALLBACK_PREFIX.length).trim();
};

export const getVisibleServiceNotes = (notes?: string | null) => {
  const normalizedNotes = (notes || "").trim();
  if (!normalizedNotes.startsWith(ASSIGNED_STAFF_FALLBACK_PREFIX)) {
    return normalizedNotes;
  }

  const [, ...remainingLines] = normalizedNotes.split(/\r?\n/);
  return remainingLines.join("\n").trim();
};

export const isAssignedStaffSchemaCacheError = (error: unknown) => {
  const text = [
    error instanceof Error ? error.message : "",
    typeof error === "object" && error !== null && "message" in error ? String(error.message) : "",
    typeof error === "object" && error !== null && "details" in error ? String(error.details) : "",
    typeof error === "object" && error !== null && "hint" in error ? String(error.hint) : "",
    typeof error === "string" ? error : "",
  ]
    .join(" ")
    .toLocaleLowerCase("en-US");

  return text.includes("assigned_staff") && text.includes("schema cache");
};