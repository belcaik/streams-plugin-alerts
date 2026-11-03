import {
  CORE_EVENTS, normalizeConfig, eventFields, renderTemplate,
  selectAlert, resolvePresentation, sampleEvents,
} from "./alerts-core.js";

const root = document.querySelector(".st-alerts");
const installedStyles = new Set();
const installedScripts = new Set();
let config = normalizeConfig();
let packs = [];
let queue = [];
let draining = false;

async function loadJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

function activePacks(external, bundled, settings) {
  const validExternal = external.filter((pack) => Array.isArray(pack.alerts) && pack.alerts.length > 0);
  if (!validExternal.length) return bundled ? [bundled] : [];
  const available = new Map(validExternal.map((pack) => [pack.name, pack]));
  if (bundled) available.set("default", bundled);
  if (!settings.packs.length) return validExternal;
  return settings.packs.map((name) => available.get(name)).filter(Boolean);
}

function enqueue(event) {
  if (!config.events.includes(event?.type)) return;
  if (event.type === "chat" && !config.chat_alerts) return;
  const alert = selectAlert(packs, event);
  if (!alert) return;
  if (queue.length >= config.max_queue) {
    console.warn(`[alerts] cola llena; se descarta ${event.type}`);
    return;
  }
  const pack = packs.find((candidate) => candidate.alerts.includes(alert));
  queue.push({ alert, event, pack: pack?.name ?? "" });
  if (!draining) void drain();
}

async function drain() {
  draining = true;
  try {
    while (queue.length) {
      const item = queue.shift();
      try {
        await showAlert(item);
      } catch (error) {
        console.warn("[alerts] no se pudo mostrar una alerta", error);
      }
      await sleep(config.gap_ms);
    }
  } finally {
    draining = false;
  }
}

async function showAlert({ alert, event, pack }) {
  const presentation = resolvePresentation(alert);
  const element = await buildMarkup(alert, event, pack, presentation);
  if (alert.css && !installedStyles.has(alert.css)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = alert.css;
    document.querySelector("#st-alerts-custom").before(link);
    installedStyles.add(alert.css);
  }
  if (alert.js) installPackScript(alert.js);
  if (presentation.sound) {
    const audio = new Audio(presentation.sound);
    audio.volume = Math.min(1, Math.max(0, (alert.volume ?? 1) * config.volume));
    audio.play().catch(() => {});
  }
  root.replaceChildren(element);
  document.dispatchEvent(new CustomEvent("st-alerts:show", { detail: { pack, alert: alert.name, eventType: event.type } }));
  await waitForTransition(element, "visible");
  await sleep(alert.duration_ms);
  await waitForTransition(element, "leaving");
  await sleep(300);
  element.remove();
  document.dispatchEvent(new CustomEvent("st-alerts:hide", { detail: { pack, alert: alert.name, eventType: event.type } }));
}

async function buildMarkup(alert, event, pack, presentation) {
  const element = document.createElement("article");
  element.className = `st-alerts__alert st-alerts__alert--${event.type} st-alerts__alert--entering`;
  element.dataset.pack = pack;
  element.dataset.alert = alert.name;
  if (alert.html) {
    const response = await fetch(alert.html);
    if (!response.ok) throw new Error(`${alert.html}: HTTP ${response.status}`);
    const template = document.createElement("template");
    template.innerHTML = await response.text();
    element.append(template.content.cloneNode(true));
  } else {
    const image = document.createElement("img");
    image.className = "st-alerts__image";
    image.dataset.image = "";
    image.alt = "";
    const content = document.createElement("div");
    content.className = "st-alerts__content";
    const title = document.createElement("div");
    title.className = "st-alerts__title";
    title.dataset.template = "";
    const message = document.createElement("div");
    message.className = "st-alerts__message";
    message.dataset.field = "message";
    content.append(title, message);
    element.append(image, content);
  }
  fillFields(element, renderTemplate(presentation.template, eventFields(event)), eventFields(event), presentation.image);
  return element;
}

function fillFields(element, rendered, fields, image) {
  for (const target of element.querySelectorAll("[data-template]")) target.textContent = rendered;
  for (const target of element.querySelectorAll("[data-field]")) {
    target.textContent = String(fields[target.dataset.field] ?? "");
  }
  for (const target of element.querySelectorAll("img[data-image]")) {
    if (image) target.src = image;
    else target.removeAttribute("src");
    target.hidden = !image;
  }
}

function installPackScript(url) {
  if (installedScripts.has(url)) return;
  const script = document.createElement("script");
  script.src = url;
  script.onerror = () => console.warn(`[alerts] no se pudo cargar ${url}`);
  document.head.append(script);
  installedScripts.add(url);
}

async function waitForTransition(element, state) {
  await new Promise((resolve) => requestAnimationFrame(resolve));
  element.classList.remove("st-alerts__alert--entering", "st-alerts__alert--visible", "st-alerts__alert--leaving");
  element.classList.add(`st-alerts__alert--${state}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function warnIssues(issues) {
  for (const issue of Array.isArray(issues) ? issues : []) {
    console.warn(`[alerts] ${issue.file}: campo ${issue.field}: ${issue.reason}`);
  }
}

async function initialize() {
  const [rawConfig, externalResult, bundledResult] = await Promise.all([
    loadJson("./config.json").catch(() => ({})),
    loadJson("/alerts/index.json").catch((error) => {
      console.warn("[alerts] catálogo externo no disponible", error);
      return { packs: [], errors: [] };
    }),
    loadJson("./packs/default/index.json").catch(() => null),
  ]);
  config = normalizeConfig(rawConfig);
  warnIssues(externalResult.errors);
  const bundled = bundledResult?.packs?.find((pack) => pack.name === "default") ?? null;
  packs = activePacks(externalResult.packs ?? [], bundled, config);
  for (const type of CORE_EVENTS) window.streams.on(type, (_data, event) => enqueue(event));
  if (config.test_mode) for (const event of sampleEvents().filter(({ type }) => type !== "chat")) enqueue(event);
}

void initialize();
