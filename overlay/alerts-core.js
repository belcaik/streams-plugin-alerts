export const CORE_EVENTS = ["follow", "sub", "gift_sub", "raid", "donation", "redemption", "chat"];

const FIELD_NAMES = ["user", "amount", "currency", "months", "count", "viewers", "reward", "message", "tier"];
const SPECIFICITY_FIELDS = ["platforms", "currency", "min_amount", "max_amount", "min_months", "min_count", "min_viewers", "reward_title"];
const clamp = (value, min, max, fallback) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const object = (value) => value !== null && typeof value === "object" ? value : {};
const isObject = (value) => value !== null && typeof value === "object";
const finite = (value) => typeof value === "number" && Number.isFinite(value);

export function normalizeConfig(raw = {}) {
  raw = object(raw);
  const events = Array.isArray(raw.events)
    ? [...new Set(raw.events.filter((type) => CORE_EVENTS.includes(type)))]
    : [...CORE_EVENTS.slice(0, 6)];
  return {
    packs: Array.isArray(raw.packs) ? raw.packs.filter((pack) => typeof pack === "string") : [],
    volume: clamp(raw.volume, 0, 1, 1),
    gap_ms: clamp(raw.gap_ms, 0, 60000, 250),
    max_queue: Math.floor(clamp(raw.max_queue, 1, 100, 20)),
    events,
    chat_alerts: raw.chat_alerts === true && events.includes("chat"),
    test_mode: raw.test_mode === true,
  };
}

export function eventFields(event) {
  const fields = Object.fromEntries(FIELD_NAMES.map((name) => [name, ""]));
  if (!isObject(event) || typeof event.user?.name !== "string") return fields;
  const data = object(event.data);
  fields.user = event.user.name;
  if (event.type === "donation") Object.assign(fields, { amount: data.amount ?? "", currency: data.currency ?? "", message: data.message ?? "" });
  if (event.type === "sub") Object.assign(fields, { months: data.months ?? "", tier: data.tier ?? "" });
  if (event.type === "gift_sub") Object.assign(fields, { count: data.count ?? "", tier: data.tier ?? "" });
  if (event.type === "raid") fields.viewers = data.viewers ?? "";
  if (event.type === "redemption") Object.assign(fields, { reward: data.reward_title ?? "", message: data.input ?? "" });
  if (event.type === "chat") fields.message = data.message ?? "";
  return fields;
}

export function renderTemplate(template, fields) {
  if (typeof template !== "string") return "";
  return template.replace(/\{(user|amount|currency|months|count|viewers|reward|message|tier)\}/g, (_, name) => String(object(fields)[name] ?? ""));
}

function completeEvent(event) {
  if (!isObject(event) || !CORE_EVENTS.includes(event.type) || typeof event.platform !== "string" || typeof event.user?.name !== "string" || !isObject(event.data)) return false;
  const data = event.data;
  switch (event.type) {
    case "donation": return finite(data.amount) && ["currency", "message"].every((key) => typeof data[key] === "string");
    case "sub": return finite(data.months) && typeof data.tier === "string";
    case "gift_sub": return finite(data.count) && typeof data.tier === "string";
    case "raid": return finite(data.viewers);
    case "redemption": return finite(data.cost) && ["reward_id", "reward_title", "input"].every((key) => typeof data[key] === "string");
    case "chat": return typeof data.message === "string";
    default: return true;
  }
}

export function matchesAlert(alert, event) {
  if (!isObject(alert) || alert.event !== event?.type || !completeEvent(event)) return false;
  const conditions = object(alert.conditions);
  const data = event.data;
  if (conditions.platforms !== undefined && (!Array.isArray(conditions.platforms) || !conditions.platforms.includes(event.platform))) return false;
  if (conditions.currency !== undefined && (typeof conditions.currency !== "string" || typeof data.currency !== "string" || conditions.currency.toLowerCase() !== data.currency.toLowerCase())) return false;
  for (const [condition, field, minimum] of [["min_amount", "amount", true], ["max_amount", "amount", false], ["min_months", "months", true], ["min_count", "count", true], ["min_viewers", "viewers", true]]) {
    if (conditions[condition] === undefined) continue;
    if (!finite(conditions[condition]) || !finite(data[field])) return false;
    if (minimum ? data[field] < conditions[condition] : data[field] > conditions[condition]) return false;
  }
  return conditions.reward_title === undefined || conditions.reward_title === data.reward_title;
}

export function specificity(alert) {
  const conditions = object(alert?.conditions);
  return SPECIFICITY_FIELDS.reduce((score, field) => score + (conditions[field] === undefined ? 0 : 1), 0);
}

export function selectAlert(packs, event) {
  const candidates = [];
  (Array.isArray(packs) ? packs : []).forEach((pack, packIndex) => {
    for (const alert of Array.isArray(pack?.alerts) ? pack.alerts : []) {
      if (matchesAlert(alert, event)) candidates.push({ alert, packIndex });
    }
  });
  candidates.sort((a, b) => (b.alert.priority || 0) - (a.alert.priority || 0)
    || specificity(b.alert) - specificity(a.alert)
    || a.packIndex - b.packIndex
    || (a.alert.name < b.alert.name ? -1 : a.alert.name > b.alert.name ? 1 : 0));
  return candidates[0]?.alert ?? null;
}

export function chooseVariation(alert, random = Math.random) {
  const variations = Array.isArray(alert?.variations) ? alert.variations : [];
  const total = variations.reduce((sum, variation) => sum + (finite(variation?.weight) && variation.weight > 0 ? variation.weight : 0), 0);
  if (!total) return null;
  const value = clamp(random(), 0, 1 - Number.EPSILON, 0) * total;
  let accumulated = 0;
  for (const variation of variations) {
    accumulated += finite(variation?.weight) && variation.weight > 0 ? variation.weight : 0;
    if (value < accumulated) return variation;
  }
  return variations.at(-1) ?? null;
}

export function resolvePresentation(alert, random = Math.random) {
  const variation = chooseVariation(alert, random);
  return {
    template: variation?.template ?? alert?.template ?? "",
    sound: variation?.sound ?? alert?.sound ?? null,
    image: variation?.image ?? null,
  };
}

export function sampleEvents(platform = "twitch") {
  const samples = {
    follow: {},
    sub: { tier: "1000", months: 3 },
    gift_sub: { tier: "1000", count: 5 },
    raid: { viewers: 42 },
    donation: { amount: 5, currency: "USD", message: "Gracias por el stream" },
    redemption: { reward_id: "reward-1", reward_title: "Hidrátate", cost: 100, input: "¡Salud!" },
    chat: { message: "¡Hola!" },
  };
  return CORE_EVENTS.map((type) => ({
    id: `sample-${type}`,
    platform,
    type,
    user: { id: "sample-user", name: "Viewer", roles: [] },
    data: samples[type],
    ts: "2026-01-01T00:00:00.000Z",
  }));
}
