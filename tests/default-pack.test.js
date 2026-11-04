import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const packRoot = `${root}overlay/packs/default`;
const coreEvents = ["follow", "sub", "gift_sub", "raid", "donation", "redemption", "chat"];

function field(toml, name) {
  const match = toml.match(new RegExp(`^${name} = (.+)$`, "m"));
  assert.ok(match, `falta ${name}`);
  return JSON.parse(match[1]);
}

test("el pack default declara siete alertas coherentes con sus assets", async () => {
  const index = JSON.parse(await readFile(`${packRoot}/index.json`, "utf8"));
  assert.equal(index.packs.length, 1);
  const pack = index.packs[0];
  assert.equal(pack.name, "default");
  assert.equal(pack.alerts.length, 7);
  assert.deepEqual([...pack.alerts.map(({ event }) => event)].sort(), [...coreEvents].sort());
  assert.equal(new Set(pack.alerts.map(({ name }) => name)).size, 7);

  for (const alert of pack.alerts) {
    assert.ok(alert.css.startsWith("/p/alerts/packs/default/"));
    const toml = await readFile(`${packRoot}/${alert.name}/alert.toml`, "utf8");
    await access(`${packRoot}/${alert.name}/style.css`);
    assert.equal(field(toml, "event"), alert.event);
    assert.equal(field(toml, "template"), alert.template);
    assert.equal(field(toml, "duration_ms"), alert.duration_ms);
    for (const value of Object.values(alert)) {
      if (typeof value === "string") assert.doesNotMatch(value, /https?:\/\//);
    }
  }
});

test("plugin.toml declara identidad permisos y config sin worker", async () => {
  const manifest = await readFile(`${root}plugin.toml`, "utf8");
  assert.match(manifest, /^name = "alerts"$/m);
  assert.deepEqual(JSON.parse(manifest.match(/^listens = (\[.*\])$/m)[1]), coreEvents);
  assert.match(manifest, /^emits = \[\]$/m);
  assert.doesNotMatch(manifest, /^\[worker\]$/m);
  const config = manifest.split("[config]\n")[1];
  const keys = [...config.matchAll(/^([a-z_]+) =/gm)].map((match) => match[1]).sort();
  assert.deepEqual(keys, ["chat_alerts", "events", "gap_ms", "max_queue", "packs", "test_mode", "volume"]);
});
