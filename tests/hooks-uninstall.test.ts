import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { addHookToSettings, uninstallHook } from "../src/hooks.js";
import type { SettingsFile } from "../src/hooks.js";

const scratchDirs: string[] = [];

function makeScratch(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `auriga-uninstall-hook-${label}-`));
  scratchDirs.push(dir);
  return dir;
}

after(() => {
  for (const d of scratchDirs) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function seedSettings(dir: string, file: string, marker: string): void {
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  const { settings } = addHookToSettings({}, "Notification", "node /x.mjs", marker);
  fs.writeFileSync(path.join(dir, ".claude", file), JSON.stringify(settings, null, 2));
}

function seedHookDir(dir: string, name: string): void {
  const hookDir = path.join(dir, ".claude", "hooks", name);
  fs.mkdirSync(hookDir, { recursive: true });
  fs.writeFileSync(path.join(hookDir, "index.mjs"), "// hook payload\n");
  fs.writeFileSync(path.join(hookDir, "config.json"), "{}");
}

describe("uninstallHook", () => {
  test("removes the hook directory and the settings.json registration", async () => {
    const cwd = makeScratch("happy");
    seedHookDir(cwd, "notify");
    seedSettings(cwd, "settings.json", "auriga:notify");

    await uninstallHook("notify", { cwd });

    assert.equal(fs.existsSync(path.join(cwd, ".claude/hooks/notify")), false);
    const settings = JSON.parse(
      fs.readFileSync(path.join(cwd, ".claude/settings.json"), "utf-8"),
    ) as SettingsFile;
    assert.equal(settings.hooks?.Notification, undefined);
  });

  test("idempotent: nothing on disk → no-op, no throw", async () => {
    const cwd = makeScratch("empty");
    await uninstallHook("notify", { cwd });
    // No spurious files created
    assert.equal(fs.existsSync(path.join(cwd, ".claude")), false);
  });

  test("settings present but hook dir already deleted: still unmerges", async () => {
    const cwd = makeScratch("dironly");
    seedSettings(cwd, "settings.json", "auriga:notify");
    // No hook dir at all

    await uninstallHook("notify", { cwd });

    const settings = JSON.parse(
      fs.readFileSync(path.join(cwd, ".claude/settings.json"), "utf-8"),
    ) as SettingsFile;
    assert.equal(settings.hooks?.Notification, undefined);
  });

  test("hook dir present but settings missing: still rm the dir", async () => {
    const cwd = makeScratch("noset");
    seedHookDir(cwd, "notify");

    await uninstallHook("notify", { cwd });

    assert.equal(fs.existsSync(path.join(cwd, ".claude/hooks/notify")), false);
    assert.equal(fs.existsSync(path.join(cwd, ".claude/settings.json")), false);
  });

  test("cleans BOTH settings.json AND settings.local.json (cross-scope stale markers)", async () => {
    // User installed once at project scope, switched to project-local later,
    // and now the marker is stuck in BOTH files. Uninstall must clear both
    // so the hook doesn't fire from the leftover scope.
    const cwd = makeScratch("both");
    seedHookDir(cwd, "notify");
    seedSettings(cwd, "settings.json", "auriga:notify");
    seedSettings(cwd, "settings.local.json", "auriga:notify");

    await uninstallHook("notify", { cwd });

    const shared = JSON.parse(
      fs.readFileSync(path.join(cwd, ".claude/settings.json"), "utf-8"),
    ) as SettingsFile;
    const local = JSON.parse(
      fs.readFileSync(path.join(cwd, ".claude/settings.local.json"), "utf-8"),
    ) as SettingsFile;
    assert.equal(shared.hooks?.Notification, undefined);
    assert.equal(local.hooks?.Notification, undefined);
  });

  test("preserves unrelated settings keys + unrelated hook entries", async () => {
    const cwd = makeScratch("preserve");
    fs.mkdirSync(path.join(cwd, ".claude"), { recursive: true });
    // Settings with two markers + sibling key
    const seed: SettingsFile = { enabledPlugins: { "x@y": true } } as SettingsFile;
    const step1 = addHookToSettings(seed, "Notification", "node /notify.mjs", "auriga:notify").settings;
    const step2 = addHookToSettings(step1, "Stop", "node /other.mjs", "auriga:other").settings;
    fs.writeFileSync(
      path.join(cwd, ".claude/settings.json"),
      JSON.stringify(step2, null, 2),
    );

    await uninstallHook("notify", { cwd });

    const settings = JSON.parse(
      fs.readFileSync(path.join(cwd, ".claude/settings.json"), "utf-8"),
    ) as SettingsFile;
    // sibling untouched
    assert.deepEqual(settings.enabledPlugins, { "x@y": true });
    // other hook untouched
    assert.equal(settings.hooks?.Stop?.[0].hooks[0]._marker, "auriga:other");
    // notify gone
    assert.equal(settings.hooks?.Notification, undefined);
  });

  test("rejects invalid hook names (defense in depth, before any I/O)", async () => {
    const cwd = makeScratch("badname");
    await assert.rejects(
      () => uninstallHook("../escape", { cwd }),
      /invalid hook name/,
    );
    // Nothing got created
    assert.equal(fs.existsSync(path.join(cwd, ".claude")), false);
  });

  test("does NOT touch ~/.claude (user scope) — global state stays untouched", async () => {
    const cwd = makeScratch("usersafe");
    seedHookDir(cwd, "notify");
    seedSettings(cwd, "settings.json", "auriga:notify");

    // Snapshot HOME before the call so we can confirm we never wrote there.
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-fake-home-"));
    scratchDirs.push(tmpHome);
    const originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
    try {
      await uninstallHook("notify", { cwd });
      // tmpHome must be empty afterwards
      assert.deepEqual(fs.readdirSync(tmpHome), []);
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
  });

  test("onLog stream records both settings + directory steps", async () => {
    const cwd = makeScratch("onlog");
    seedHookDir(cwd, "notify");
    seedSettings(cwd, "settings.json", "auriga:notify");

    const logs: string[] = [];
    await uninstallHook("notify", { cwd, onLog: (l) => logs.push(l) });

    assert.ok(
      logs.some((l) => /settings/i.test(l)),
      `missing settings log: ${logs.join(" | ")}`,
    );
    assert.ok(
      logs.some((l) => /notify/.test(l) && /removed/i.test(l)),
      `missing directory removal log: ${logs.join(" | ")}`,
    );
  });

  test("uses registry marker when available (instead of auriga:<name> convention)", async () => {
    // Seed a registry where the marker DIVERGES from the convention
    // (auriga-notify-custom instead of auriga:notify). uninstallHook
    // must read the registry first and clean that exact marker — a
    // missed lookup would leave the hook firing.
    const cwd = makeScratch("registry");
    fs.mkdirSync(path.join(cwd, ".claude/hooks"), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, ".claude/hooks/hooks.json"),
      JSON.stringify({
        hooks: [
          {
            name: "notify",
            description: "x",
            runtimePlatforms: ["darwin", "linux"],
            settingsEvents: [{ event: "Notification" }],
            command: 'node "$HOOK_DIR/index.mjs"',
            files: ["index.mjs"],
            marker: "auriga-notify-custom",
          },
        ],
      }),
    );
    seedHookDir(cwd, "notify");
    // Seed settings with the *custom* marker
    seedSettings(cwd, "settings.json", "auriga-notify-custom");

    await uninstallHook("notify", { cwd });

    const settings = JSON.parse(
      fs.readFileSync(path.join(cwd, ".claude/settings.json"), "utf-8"),
    ) as SettingsFile;
    assert.equal(settings.hooks?.Notification, undefined);
  });
});
