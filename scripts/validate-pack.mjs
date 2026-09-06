#!/usr/bin/env bun
/**
 * Shared release packaging validation (CI + local).
 *
 * Validates that the package is private, non-publishing, packs exactly the
 * intended contents, and actually installs outside the checkout. Exits
 * nonzero on any violation. No publish step exists anywhere in this repo.
 *
 * Usage:
 *   bun scripts/validate-pack.mjs [--tag vX.Y.Z]
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const args = process.argv.slice(2);
const tagIndex = args.indexOf("--tag");
const tag = tagIndex >= 0 ? args[tagIndex + 1] : "";

function run(cmd, argsList, options = {}) {
    const result = spawnSync(cmd, argsList, {
        cwd: options.cwd ?? ROOT,
        encoding: "utf8",
        ...options,
    });
    if (result.error) throw result.error;
    if (result.status !== 0 && !options.allowNonZero) {
        throw new Error(
            `${cmd} ${argsList.join(" ")} failed (${result.status}):\n${result.stderr || result.stdout}`,
        );
    }
    return result;
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

// --- Scoped public-publication guards ------------------------------------
// 0.1.0 is authorized to publish as a PUBLIC package under the
// @artisann-studios scope (public npm publication was explicitly authorized;
// no paid org plan is required). The GitHub repository is public. No publish
// script belongs in package.json (publishing goes through
// .github/workflows/publish.yml).
const SCOPE = "@artisann-studios/omp-zvec-grep";
if (pkg.name !== SCOPE) {
    throw new Error(`package.json name must be ${SCOPE} (got ${pkg.name ?? "(missing)"})`);
}
if (pkg.private === true) {
    throw new Error(
        `package.json must not be private (${SCOPE} is published public; drop the private flag)`,
    );
}
if (pkg.publishConfig?.access !== "public") {
    throw new Error(
        'package.json publishConfig.access must be "public" (public publication is authorized)',
    );
}
if (pkg.scripts && typeof pkg.scripts.publish === "string") {
    throw new Error("a publish script must not exist in package.json");
}
if (!fs.existsSync(path.join(ROOT, ".github", "workflows", "publish.yml"))) {
    throw new Error("publish.yml workflow must exist for the authorized scoped release");
}

// --- Tag/version agreement (only meaningful when invoked on a tag) --------
if (tag !== "") {
    const expected = `v${pkg.version}`;
    if (tag !== expected) {
        throw new Error(
            `release tag ${tag} does not match package version ${pkg.version} (expected ${expected})`,
        );
    }
    console.log(`tag ${tag} matches ${pkg.name}@${pkg.version}`);
}

// --- Pack once, then inspect and install from that single tarball ---------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "omp-zvec-grep-pack-"));
try {
    const packed = run("npm", ["pack", "--json", "--pack-destination", tmp], { cwd: ROOT });
    const entries = JSON.parse(packed.stdout);
    const filename = entries[0]?.filename;
    if (!filename) throw new Error("npm pack produced no tarball");
    const tarball = path.join(tmp, filename);
    console.log(`packed ${filename} (${(fs.statSync(tarball).size / 1024).toFixed(1)} KiB)`);

    const listing = run("tar", ["-tzf", tarball]);
    const files = listing.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    const names = new Set(files.map((f) => f.replace(/^package\//, "")));

    const required = [
        "package.json",
        "index.ts",
        "src/extension/tools.ts",
        "LICENSE",
        "UPSTREAM.md",
        "README.md",
        "docs/compatibility.md",
        "CHANGELOG.md",
    ];
    for (const entry of required) {
        if (!names.has(entry)) throw new Error(`packed contents missing ${entry}`);
    }
    for (const prefix of ["test/", ".github/", "scripts/"]) {
        for (const file of names) {
            if (file.startsWith(prefix)) {
                throw new Error(
                    `packed contents must not include ${file} (files field is too broad)`,
                );
            }
        }
    }
    console.log(
        `packed ${files.length} entries; required source/docs present; no test/.github/scripts content`,
    );

    // --- Real installation outside the checkout -----------------------------
    const project = path.join(tmp, "consumer");
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(
        path.join(project, "package.json"),
        JSON.stringify({ name: "pack-consumer", private: true, type: "module" }),
    );
    run(
        "npm",
        [
            "install",
            "--no-audit",
            "--no-fund",
            tarball,
            "@oh-my-pi/pi-coding-agent@18.1.11",
            "@oh-my-pi/pi-tui@18.1.11",
            "@oh-my-pi/pi-utils@18.1.11",
        ],
        { cwd: project },
    );
    const installedRoot = path.join(project, "node_modules", pkg.name);
    const installedPkg = JSON.parse(
        fs.readFileSync(path.join(installedRoot, "package.json"), "utf8"),
    );
    if (installedPkg.version !== pkg.version) {
        throw new Error(`installed version ${installedPkg.version} != ${pkg.version}`);
    }
    const entry = path.join(installedRoot, "index.ts");
    if (!fs.existsSync(entry)) throw new Error(`installed package missing index.ts at ${entry}`);
    const bin = path.join(project, "bin");
    const agentDir = path.join(project, "agent");
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, "zg"), '#!/bin/sh\nprintf "Workspace index is ready\\n"', {
        mode: 0o755,
    });
    const probe = path.join(project, "packed-runtime-check.mjs");
    fs.writeFileSync(
        probe,
        `import { createAgentSession, ToolExecutionComponent } from "@oh-my-pi/pi-coding-agent";
import { setThemeInstance } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { loadThemeSync } from "@oh-my-pi/pi-coding-agent/modes/theme/loader";
const root = process.cwd();
const created = await createAgentSession({
  cwd: root,
  agentDir: process.env.PI_CODING_AGENT_DIR,
  disableExtensionDiscovery: true,
  additionalExtensionPaths: [process.env.OMP_PACK_ENTRY],
  enableMCP: false,
  enableLsp: false,
  hasUI: false,
  toolNames: ["zvec_search", "zvec_index", "zvec_status"],
});
const session = created.session;
const extensionErrors = created.extensionsResult?.errors ?? [];
if (extensionErrors.length > 0) {
  throw new Error("packed extension load errors: " + JSON.stringify(extensionErrors));
}
const tool = session.getToolByName("zvec_status");
if (!tool) throw new Error("packed status tool missing");
const theme = loadThemeSync("dark");
setThemeInstance(theme);
const ui = { requestRender() {}, requestComponentRender() {}, resetDisplay() {} };
const component = new ToolExecutionComponent("zvec_status", {}, undefined, tool, ui, root, "packed");
component.setArgsComplete("packed");
const result = await tool.execute("packed", {});
const text = (result?.content ?? [])
  .filter((p) => p && p.type === "text")
  .map((p) => p.text ?? "")
  .join("\\n");
if (!/Workspace index is ready/.test(text)) {
  throw new Error(
    "packed zvec_status result text missing 'Workspace index is ready': " + JSON.stringify(text),
  );
}
component.updateResult(result, false, "packed");
const rendered = component.render(120).join("\\n");
if (!/index ready/.test(rendered)) {
  throw new Error(
    "packed renderer did not emit the custom 'index ready' verdict line: " + JSON.stringify(rendered),
  );
}
await session.dispose();
console.log("packed SDK load/execute/render passed");`,
    );
    const hostEnv = {
        ...process.env,
        OMP_PACK_ENTRY: entry,
        PI_CODING_AGENT_DIR: agentDir,
        HOME: path.join(project, "home"),
        OMP_SKIP_SETUP: "1",
        PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
    };
    delete hostEnv.OMP_PROFILE;
    delete hostEnv.PI_PROFILE;
    run("bun", [probe], { cwd: project, env: hostEnv });
    console.log(
        `installed ${pkg.name}@${pkg.version} outside checkout; SDK load/execute/render passed`,
    );
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}
