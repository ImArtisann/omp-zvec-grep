import * as fs from "node:fs";
import { strict as assert } from "node:assert";
import * as os from "node:os";
import * as path from "node:path";
import {
    DEFAULT_SETTINGS,
    deactivateProjectScope,
    loadSettings,
    projectConfigFile,
    saveSettings,
    userConfigFile,
} from "../src/extension/config.ts";

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "omp-zvec-config-worker-"));
const second = fs.mkdtempSync(path.join(os.tmpdir(), "omp-zvec-config-second-"));
const agent = process.env.PI_CODING_AGENT_DIR!;
fs.mkdirSync(agent, { recursive: true });
fs.mkdirSync(path.dirname(userConfigFile()), { recursive: true });
fs.writeFileSync(
    userConfigFile(),
    JSON.stringify({ defaultLimit: 43, autoIndex: true, unrelatedUser: { keep: true } }),
);
const file = projectConfigFile(cwd);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify({ projectScope: true }));
if (loadSettings(cwd).defaultLimit !== 7 || loadSettings(cwd).autoIndex !== false)
    throw new Error("active project defaults leaked user values");
fs.writeFileSync(
    file,
    JSON.stringify({
        defaultLimit: 31,
        autoIndex: true,
        projectScope: false,
        unrelated: { keep: true },
    }),
);
saveSettings(
    { ...DEFAULT_SETTINGS, defaultLimit: 11, autoIndex: false, projectScope: true },
    "project",
    cwd,
);
if (loadSettings(cwd).defaultLimit !== 11 || loadSettings(cwd).autoIndex !== false)
    throw new Error("active project values not applied");
if ((JSON.parse(fs.readFileSync(file, "utf8")) as { unrelated?: unknown }).unrelated === undefined)
    throw new Error("unrelated project keys were lost");
deactivateProjectScope(cwd);
if (loadSettings(cwd).defaultLimit !== 43 || loadSettings(cwd).autoIndex !== true)
    throw new Error("dormant project did not restore user values");
if ((JSON.parse(fs.readFileSync(file, "utf8")) as { defaultLimit?: number }).defaultLimit !== 11)
    throw new Error("dormant values were lost");
fs.writeFileSync(file, JSON.stringify({ settingsScope: "project", defaultLimit: 17 }));
if (!loadSettings(cwd).projectScope || loadSettings(cwd).defaultLimit !== 17)
    throw new Error("legacy project activation failed");
if (loadSettings(second).defaultLimit !== 43 || loadSettings(second).autoIndex !== true)
    throw new Error("project scope leaked across workspaces");
fs.writeFileSync(file, "{ malformed");
let malformedRejected = false;
try {
    saveSettings(DEFAULT_SETTINGS, "project", cwd);
} catch {
    malformedRejected = true;
}
if (!malformedRejected) throw new Error("malformed config was overwritten");
if (fs.readFileSync(file, "utf8") !== "{ malformed") throw new Error("malformed config changed");
fs.rmSync(file);
const target = path.join(cwd, "outside.json");
const originalTarget = JSON.stringify({ keep: true });
fs.writeFileSync(target, originalTarget);
fs.symlinkSync(target, file);
assert.throws(() => saveSettings(DEFAULT_SETTINGS, "project", cwd));
if (fs.readFileSync(target, "utf8") !== originalTarget) throw new Error("symlink target changed");
fs.rmSync(file);
fs.symlinkSync(path.join(cwd, "missing.json"), file);
assert.throws(() => saveSettings(DEFAULT_SETTINGS, "project", cwd));
fs.rmSync(cwd, { recursive: true, force: true });
fs.rmSync(second, { recursive: true, force: true });
console.log("config profile/scoped safety parity passed");
