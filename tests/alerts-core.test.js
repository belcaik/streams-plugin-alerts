import test from "node:test";
import assert from "node:assert/strict";
import {
  CORE_EVENTS, normalizeConfig, eventFields, renderTemplate, matchesAlert,
  specificity, selectAlert, chooseVariation, resolvePresentation, sampleEvents,
} from "../overlay/alerts-core.js";

const event = (type = "donation") => sampleEvents().find((sample) => sample.type === type);
const alert = (extra = {}) => ({ name: "a", event: "donation", template: "{user}", priority: 0, conditions: {}, variations: [], ...extra });

test("normalizeConfig aplica defaults", () => {
  assert.deepEqual(normalizeConfig(), {
    packs: [], volume: 1, gap_ms: 250, max_queue: 20,
    events: CORE_EVENTS.slice(0, 6), chat_alerts: false, test_mode: false,
  });
});

test("normalizeConfig limita números y filtra eventos", () => {
  const config = normalizeConfig({ volume: 4, gap_ms: -1, max_queue: 1000.9, events: ["chat", "chat", "bad"], chat_alerts: true });
  assert.deepEqual(config.events, ["chat"]);
  assert.equal(config.volume, 1);
  assert.equal(config.gap_ms, 0);
  assert.equal(config.max_queue, 100);
  assert.equal(config.chat_alerts, true);
  assert.equal(normalizeConfig({ chat_alerts: true }).chat_alerts, false);
});

test("normalizeConfig no muta la entrada", () => {
  const raw = { packs: ["default"], events: ["follow"] };
  const snapshot = structuredClone(raw);
  const normalized = normalizeConfig(raw);
  normalized.packs.push("otro");
  normalized.events.push("chat");
  assert.deepEqual(raw, snapshot);
});

test("eventFields mapea los siete eventos y conserva las nueve claves", () => {
  const expected = [
    ["follow", { user: "Viewer" }],
    ["sub", { months: 3, tier: "1000" }],
    ["gift_sub", { count: 5, tier: "1000" }],
    ["raid", { viewers: 42 }],
    ["donation", { amount: 5, currency: "USD", message: "Gracias por el stream" }],
    ["redemption", { reward: "Hidrátate", message: "¡Salud!" }],
    ["chat", { message: "¡Hola!" }],
  ];
  for (const [type, values] of expected) {
    const fields = eventFields(event(type));
    assert.deepEqual(Object.keys(fields), ["user", "amount", "currency", "months", "count", "viewers", "reward", "message", "tier"]);
    for (const [key, value] of Object.entries(values)) assert.equal(fields[key], value);
  }
  assert.equal(eventFields(null).user, "");
});

test("renderTemplate sustituye repeticiones sin interpretar HTML", () => {
  const rendered = renderTemplate("{user} {user} {amount} {unknown}", { user: "<img>", amount: 5 });
  assert.equal(rendered, "<img> <img> 5 {unknown}");
});

test("matchesAlert comprueba tipo, plataforma y currency ASCII", () => {
  assert.equal(matchesAlert(alert(), event()), true);
  assert.equal(matchesAlert(alert({ event: "raid" }), event()), false);
  assert.equal(matchesAlert(alert({ conditions: { platforms: ["kick"] } }), event()), false);
  assert.equal(matchesAlert(alert({ conditions: { platforms: ["youtube"] } }), sampleEvents("youtube")[4]), true);
  assert.equal(matchesAlert(alert({ conditions: { currency: "usd" } }), event()), true);
  assert.equal(matchesAlert(alert({ conditions: { currency: "EUR" } }), event()), false);
});

test("matchesAlert aplica todos los límites numéricos sin coerciones", () => {
  for (const [type, conditions] of [["donation", { min_amount: 5, max_amount: 5 }], ["sub", { min_months: 3 }], ["gift_sub", { min_count: 5 }], ["raid", { min_viewers: 42 }]]) {
    assert.equal(matchesAlert(alert({ event: type, conditions }), event(type)), true);
    const key = Object.keys(conditions)[0];
    assert.equal(matchesAlert(alert({ event: type, conditions: { [key]: key === "max_amount" ? 4 : 43 } }), event(type)), false);
  }
  assert.equal(matchesAlert(alert({ conditions: { min_amount: "5" } }), event()), false);
  assert.equal(matchesAlert(alert({ conditions: { min_amount: NaN } }), event()), false);
});

test("matchesAlert compara reward_title exactamente", () => {
  const redemption = alert({ event: "redemption", conditions: { reward_title: "Hidrátate" } });
  assert.equal(matchesAlert(redemption, event("redemption")), true);
  assert.equal(matchesAlert(redemption, { ...event("redemption"), data: { ...event("redemption").data, reward_title: "hidrátate" } }), false);
});

test("selectAlert prioriza priority y después specificity", () => {
  const packs = [{ alerts: [alert(), alert({ name: "b", priority: 2 }), alert({ name: "c", priority: 2, conditions: { currency: "USD" } })] }];
  assert.equal(selectAlert(packs, event()).name, "c");
});

test("specificity suma cada restricción presente", () => {
  const conditions = { platforms: ["youtube"], currency: "USD", min_amount: 1, max_amount: 9, min_months: 1, min_count: 1, min_viewers: 1, reward_title: "x" };
  assert.equal(specificity(alert({ conditions })), 8);
});

test("selectAlert desempata por orden de pack y nombre", () => {
  const first = { name: "first", alerts: [alert({ name: "z" }), alert({ name: "a" })] };
  const second = { name: "second", alerts: [alert({ name: "b" })] };
  assert.equal(selectAlert([first, second], event()).name, "a");
  assert.equal(selectAlert([{ ...first, alerts: [] }, second], event()).name, "b");
});

test("chooseVariation usa acumulado y satura RNG", () => {
  const variations = [{ template: "a", weight: 2 }, { template: "b", weight: 3 }];
  const weighted = alert({ variations });
  assert.equal(chooseVariation(weighted, () => 0).template, "a");
  assert.equal(chooseVariation(weighted, () => 0.4).template, "b");
  assert.equal(chooseVariation(weighted, () => 0.999).template, "b");
  assert.equal(chooseVariation(weighted, () => -1).template, "a");
  assert.equal(chooseVariation(weighted, () => 1).template, "b");
  assert.equal(chooseVariation(alert()), null);
});

test("resolvePresentation hereda template y sound y añade image", () => {
  const base = alert({ template: "base", sound: "base.ogg", variations: [{ image: "one.webp", weight: 1 }, { template: "two", sound: "two.ogg", weight: 1 }] });
  assert.deepEqual(resolvePresentation(base, () => 0), { template: "base", sound: "base.ogg", image: "one.webp" });
  assert.deepEqual(resolvePresentation(base, () => 0.75), { template: "two", sound: "two.ogg", image: null });
});

test("eventos incompletos no lanzan ni coinciden", () => {
  for (const value of [null, {}, { type: "donation" }, { ...event(), data: { amount: "5" } }]) {
    assert.doesNotThrow(() => matchesAlert(alert(), value));
    assert.equal(matchesAlert(alert(), value), false);
  }
});

test("sampleEvents es serializable y respeta los schemas núcleo", () => {
  const keys = { follow: [], sub: ["tier", "months"], gift_sub: ["tier", "count"], raid: ["viewers"], donation: ["amount", "currency", "message"], redemption: ["reward_id", "reward_title", "cost", "input"], chat: ["message"] };
  for (const platform of ["twitch", "kick", "youtube"]) {
    const samples = sampleEvents(platform);
    assert.deepEqual(samples.map(({ type }) => type), CORE_EVENTS);
    for (const sample of samples) {
      assert.deepEqual(Object.keys(sample), ["id", "platform", "type", "user", "data", "ts"]);
      assert.deepEqual(Object.keys(sample.user), ["id", "name", "roles"]);
      assert.deepEqual(Object.keys(sample.data), keys[sample.type]);
      assert.equal(sample.platform, platform);
      assert.deepEqual(JSON.parse(JSON.stringify(sample)), sample);
    }
  }
});
