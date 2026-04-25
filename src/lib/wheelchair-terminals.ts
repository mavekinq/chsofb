const normalizeTerminal = (value: string) =>
  value
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const SERVICE_TERMINAL_INVENTORY_ALIASES: Record<string, string[]> = {
  t1: ["iç hat", "ic hat", "ichat"],
  t2: ["t2"],
};

export const getWheelchairInventoryTerminalAliases = (serviceTerminal: string) => {
  const normalizedTerminal = normalizeTerminal(serviceTerminal);
  return SERVICE_TERMINAL_INVENTORY_ALIASES[normalizedTerminal] ?? [normalizedTerminal];
};

export const matchesWheelchairInventoryTerminal = (serviceTerminal: string, wheelchairTerminal: string) => {
  const aliases = getWheelchairInventoryTerminalAliases(serviceTerminal);
  return aliases.includes(normalizeTerminal(wheelchairTerminal));
};