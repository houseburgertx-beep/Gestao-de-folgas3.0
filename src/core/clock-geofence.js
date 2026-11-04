import { asBoolean, haversineMeters } from "./utils.js";

export function clockLocationError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.geoValidated = false;
  return error;
}

export function coordinateNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (typeof value !== "string" || !/^[+-]?\d+(?:[.,]\d+)?$/.test(value.trim())) return NaN;
  return Number(value.trim().replace(",", "."));
}

export function validStoreCoordinates(location) {
  const latitude = coordinateNumber(location?.Latitude);
  const longitude = coordinateNumber(location?.Longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 && !(latitude === 0 && longitude === 0);
}

export function chooseClockStoreLocation(locations, storeId) {
  const matching = (locations || []).filter((location) => String(location?.LojaID ?? "").trim() === String(storeId).trim());
  const active = matching.filter((location) => asBoolean(location.Ativo));
  if (matching.length && !active.length) throw clockLocationError("clock/location-inactive", "O local de ponto desta unidade está desativado. Solicite a conferência da gerência.");
  return active.filter(validStoreCoordinates).sort((a, b) =>
    (Date.parse(b.DataAtualizacao || b.DataCriacao || "") || 0) - (Date.parse(a.DataAtualizacao || a.DataCriacao || "") || 0)
  )[0] || null;
}

export function checkClockGeofence(payload, location) {
  if (!validStoreCoordinates(location)) throw clockLocationError("clock/location-config", "A unidade está sem coordenadas válidas para o ponto. Solicite à gerência que confira o local da loja.");
  const latitude = coordinateNumber(payload?.latitude);
  const longitude = coordinateNumber(payload?.longitude);
  const accuracy = coordinateNumber(payload?.accuracy);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || !Number.isFinite(accuracy) || accuracy < 0) {
    throw clockLocationError("clock/location-invalid", "Não foi possível validar a localização do aparelho. Atualize a localização e tente novamente.");
  }
  const safeAccuracy = Math.ceil(accuracy);
  const configuredRadius = location.RaioMetros == null || location.RaioMetros === "" ? 150 : coordinateNumber(location.RaioMetros);
  if (!Number.isFinite(configuredRadius) || configuredRadius <= 0) throw clockLocationError("clock/location-config", "O raio do ponto desta unidade está inválido. Solicite a conferência da gerência.");
  const radius = Math.max(150, configuredRadius);
  const exactDistance = haversineMeters(latitude, longitude, coordinateNumber(location.Latitude), coordinateNumber(location.Longitude));
  const distance = Math.round(exactDistance);
  // Same conservative coordinate bound is checked independently by RTDB rules.
  const conservativeDistance = Math.hypot(latitude - coordinateNumber(location.Latitude), longitude - coordinateNumber(location.Longitude)) * 112000;
  const coarseContained = safeAccuracy > 350 && safeAccuracy <= 5000 && conservativeDistance + safeAccuracy <= configuredRadius;
  if (safeAccuracy > 350 && !coarseContained) throw clockLocationError("clock/location-imprecise", `Sinal de localização muito impreciso (±${safeAccuracy} m). Ative o Wi-Fi ou aproxime-se de uma área aberta para calibrar o GPS.`);
  const withinStore = coarseContained || distance <= radius || (distance - Math.min(safeAccuracy * 0.6, 90) <= radius && safeAccuracy <= 350);
  if (!withinStore) throw clockLocationError("clock/location-outside", `Você está a ${distance} m da loja (precisão ±${safeAccuracy} m), fora do raio de ${radius} m.`);
  return { latitude, longitude, accuracy, safeAccuracy, distance, radius, mode: coarseContained ? "coarse-contained" : "precise" };
}
