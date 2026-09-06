import * as fs from "node:fs";
import * as path from "node:path";
import { discoverAuthStorage, ModelRegistry, SessionManager } from "@oh-my-pi/pi-coding-agent";
import {
    ExtensionRunner,
    loadExtensions,
} from "@oh-my-pi/pi-coding-agent/extensibility/extensions";

const mode = process.env.LIFECYCLE_MODE!;
const root = process.env.LIFECYCLE_ROOT!;
const agent = process.env.LIFECYCLE_AGENT!;
const state = path.join(root, "state.log");
const fakeBin = path.join(root, "bin");
fs.mkdirSync(fakeBin, { recursive: true });
fs.writeFileSync(
    path.join(fakeBin, "zg"),
    `#!/usr/bin/env node
const fs = require('node:fs');
const mode = process.env.LIFECYCLE_MODE;
const state = process.env.LIFECYCLE_STATE;
const [cmd] = process.argv.slice(2);
fs.appendFileSync(state, cmd + ':start\\n');
if (cmd === 'status') {
  if (mode === 'ready') { console.log('Workspace index is ready'); process.exit(0); }
  if (mode === 'operational-error') { console.error('permission denied'); process.exit(2); }
  console.log(mode === 'stale' ? 'Workspace index needs an update' : 'No zvec-grep index found for workspace');
  process.exit(1);
}
if (cmd === 'index') {
  if (mode === 'dedup' || mode === 'shutdown') {
    setTimeout(() => { fs.appendFileSync(state, 'index:done\\n'); process.exit(0); }, 1000);
  } else if (mode === 'failure') {
    console.error('index exploded');
    process.exit(1);
  } else {
    fs.appendFileSync(state, 'index:done\\n');
    process.exit(0);
  }
}
process.exit(2);
`,
    { mode: 0o755 },
);
process.env.PATH = `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`;
process.env.PI_CODING_AGENT_DIR = agent;
const config = path.join(root, ".zvec-grep");
fs.mkdirSync(config, { recursive: true });
fs.writeFileSync(
    path.join(config, "config.json"),
    JSON.stringify({ projectScope: true, autoIndex: mode !== "off" }),
);
const loaded = await loadExtensions(
    [path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "index.ts")],
    root,
);
if (loaded.errors.length) throw new Error(loaded.errors.map((e) => e.error).join("; "));
const manager = SessionManager.inMemory(root);
const registry = new ModelRegistry(
    await discoverAuthStorage(agent),
    path.join(agent, "models.yml"),
);
const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, root, manager, registry);
const ctx = runner.createContext();
const start = loaded.extensions[0]!.handlers.get("session_start") ?? [];
const shutdown = loaded.extensions[0]!.handlers.get("session_shutdown") ?? [];
const event = { type: "session_start" as const };
const handlers = [...start, ...start];
await Promise.all(handlers.map((handler) => handler(event, ctx)));
if (mode === "shutdown") {
    const until = Date.now() + 500;
    while (
        Date.now() < until &&
        (!fs.existsSync(state) || !fs.readFileSync(state, "utf8").includes("index:start"))
    )
        await Bun.sleep(10);
    await Promise.all(shutdown.map((handler) => handler({ type: "session_shutdown" }, ctx)));
}
const deadline = Date.now() + 1800;
while (Date.now() < deadline) {
    const text = fs.existsSync(state) ? fs.readFileSync(state, "utf8") : "";
    if (mode === "dedup" && text.includes("index:done")) break;
    if (
        mode !== "dedup" &&
        mode !== "shutdown" &&
        (mode === "off" ||
            text.includes("index:done") ||
            mode === "ready" ||
            mode === "operational-error")
    )
        break;
    await Bun.sleep(20);
}
const output = fs.existsSync(state) ? fs.readFileSync(state, "utf8") : "";
console.log(JSON.stringify({ mode, output }));
process.exit(0);
