export const nowIso = () => new Date().toISOString();

export const todayIso = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const monthIso = (date = new Date()) => todayIso(date).slice(0, 7);

export const uuid = () =>
  globalThis.crypto?.randomUUID?.() ||
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;

export const asBoolean = (value) =>
  value === true ||
  value === 1 ||
  ["true", "1", "sim", "yes"].includes(String(value || "").toLowerCase());

export const normalizeEmail = (value) =>
  String(value || "").trim().toLowerCase();

export const clone = (value) =>
  value === undefined ? undefined : JSON.parse(JSON.stringify(value));

export const cleanObject = (value) => {
  if (Array.isArray(value)) return value.map(cleanObject);
  if (!value || typeof value !== "object") return value ?? "";
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, cleanObject(item)]),
  );
};

export const dateRange = (start, end) => {
  const output = [];
  const current = new Date(`${start}T12:00:00`);
  const limit = new Date(`${end || start}T12:00:00`);
  while (
    Number.isFinite(current.getTime()) &&
    Number.isFinite(limit.getTime()) &&
    current <= limit &&
    output.length < 370
  ) {
    output.push(todayIso(current));
    current.setDate(current.getDate() + 1);
  }
  return output;
};

export const minutesText = (minutes) => {
  const numeric = Math.round(Number(minutes || 0));
  const sign = numeric < 0 ? "-" : "";
  const absolute = Math.abs(numeric);
  return `${sign}${Math.floor(absolute / 60)}h ${String(
    absolute % 60,
  ).padStart(2, "0")}min`;
};

export const minutesBetween = (start, end) => {
  const first = new Date(start).getTime();
  const last = new Date(end).getTime();
  return Number.isFinite(first) && Number.isFinite(last)
    ? Math.max(0, Math.round((last - first) / 60000))
    : 0;
};

export const haversineMeters = (lat1, lon1, lat2, lon2) => {
  const toRadians = (value) => (Number(value) * Math.PI) / 180;
  const earthRadius = 6371000;
  const latitudeDelta = toRadians(lat2 - lat1);
  const longitudeDelta = toRadians(lon2 - lon1);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const csvDataUrl = (rows, columns) => {
  const escape = (value) =>
    `"${String(value ?? "").replaceAll('"', '""')}"`;
  const content = [
    columns.map(escape).join(";"),
    ...rows.map((row) => columns.map((column) => escape(row[column])).join(";")),
  ].join("\n");
  return `data:text/csv;charset=utf-8,${encodeURIComponent("\uFEFF" + content)}`;
};

export const safeFileName = (value) =>
  String(value || "arquivo")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

export const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
