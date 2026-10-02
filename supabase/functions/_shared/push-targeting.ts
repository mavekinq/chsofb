export type PushSubscriptionRecipient = {
  user_name: string;
};

export type ServiceAlertPreference = {
  full_name: string;
  service_alerts_enabled: boolean;
};

export const getSubscriptionsWithServiceAlertsEnabled = <
  T extends PushSubscriptionRecipient,
>(
  subscriptions: T[],
  preferences: ServiceAlertPreference[],
  notificationKind: string | undefined,
) => {
  if (notificationKind === "announcement") {
    return subscriptions;
  }

  const disabledNames = new Set(
    preferences
      .filter((preference) => !preference.service_alerts_enabled)
      .map((preference) => preference.full_name.trim().toLocaleLowerCase())
      .filter(Boolean),
  );

  return subscriptions.filter((subscription) =>
    !disabledNames.has(subscription.user_name.trim().toLocaleLowerCase())
  );
};

type ScheduleEmployee = {
  name: string;
  shifts: Record<string, string>;
};

type SchedulePayload = {
  weekDates: string[];
  employees: ScheduleEmployee[];
};

const getIstanbulDateKey = (date: Date) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Istanbul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(date);

const getIstanbulMinuteOfDay = (date: Date) => {
  const [hour, minute] = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date).split(":").map(Number);

  return (hour || 0) * 60 + (minute || 0);
};

const getPreviousDateKey = (dateKey: string) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
};

const isShiftActive = (shiftValue: string, minuteNow: number) => {
  const match = shiftValue.trim().replace(/\s+/g, "").match(/^(\d{2})(\d{2})-(\d{2})(\d{2})$/);
  if (!match) return false;

  const start = Number(match[1]) * 60 + Number(match[2]);
  const end = Number(match[3]) * 60 + Number(match[4]);
  return end <= start
    ? minuteNow >= start || minuteNow < end
    : minuteNow >= start && minuteNow < end;
};

const isOvernightShiftActive = (shiftValue: string, minuteNow: number) => {
  const match = shiftValue.trim().replace(/\s+/g, "").match(/^(\d{2})(\d{2})-(\d{2})(\d{2})$/);
  if (!match) return false;

  const start = Number(match[1]) * 60 + Number(match[2]);
  const end = Number(match[3]) * 60 + Number(match[4]);
  return end <= start && minuteNow < end;
};

const parseSchedulePayload = (value: unknown): SchedulePayload | null => {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.weekDates) || !Array.isArray(candidate.employees)) return null;
  if (candidate.weekDates.some((date) => typeof date !== "string")) return null;

  const employees: ScheduleEmployee[] = [];
  for (const employee of candidate.employees) {
    if (typeof employee !== "object" || employee === null) return null;
    const record = employee as Record<string, unknown>;
    if (typeof record.name !== "string" || typeof record.shifts !== "object" || record.shifts === null || Array.isArray(record.shifts)) {
      return null;
    }
    const shifts = record.shifts as Record<string, unknown>;
    if (Object.values(shifts).some((shift) => typeof shift !== "string")) return null;
    employees.push({ name: record.name, shifts: shifts as Record<string, string> });
  }

  return { weekDates: candidate.weekDates as string[], employees };
};

export const getOnShiftNamesFromSchedule = (value: unknown, now = new Date()) => {
  const schedule = parseSchedulePayload(value);
  if (!schedule) return [];

  const todayKey = getIstanbulDateKey(now);
  const todayIndex = schedule.weekDates.indexOf(todayKey);
  if (todayIndex === -1) return [];

  const previousDayKey = todayIndex > 0
    ? schedule.weekDates[todayIndex - 1]
    : getPreviousDateKey(todayKey);
  const minuteNow = getIstanbulMinuteOfDay(now);

  return schedule.employees
    .filter((employee) => isShiftActive(employee.shifts[todayKey] || "", minuteNow)
      || isOvernightShiftActive(employee.shifts[previousDayKey] || "", minuteNow))
    .map((employee) => employee.name.trim())
    .filter(Boolean);
};

export const getEligiblePushSubscriptions = <T extends PushSubscriptionRecipient>(
  subscriptions: T[],
  notificationKind: string | undefined,
  onShiftUsers: string[] | undefined,
  schedulePayload: unknown,
  now = new Date(),
) => {
  if (notificationKind === "announcement") {
    return subscriptions;
  }

  const onShiftNames = getOnShiftNamesFromSchedule(schedulePayload, now);
  const eligibleNames = new Set(onShiftNames.map((userName) => userName.toLocaleLowerCase()));
  if (onShiftUsers !== undefined) {
    const requestedNames = new Set(
      onShiftUsers
        .map((userName) => userName.trim().toLocaleLowerCase())
        .filter(Boolean),
    );
    for (const name of eligibleNames) {
      if (!requestedNames.has(name)) eligibleNames.delete(name);
    }
  }

  if (eligibleNames.size === 0) {
    return [];
  }

  return subscriptions.filter((subscription) =>
    eligibleNames.has(subscription.user_name.trim().toLocaleLowerCase())
  );
};
