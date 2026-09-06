import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
    DEFAULT_SETTINGS,
    deactivateProjectScope,
    loadSettings,
    projectConfigFile,
    saveSettings,
} from "../src/extension/config.ts";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function root(): string {
    const value = fs.mkdtempSync(path.join(os.tmpdir(), "omp-zvec-config-"));
    roots.push(value);
    return value;
}

describe("scoped config persistence", () => {
    test("project scope is self-contained and preserves unrelated keys/dormant values", () => {
        const cwd = root();
        const file = projectConfigFile(cwd);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(
            file,
            JSON.stringify({
                defaultLimit: 31,
                autoIndex: true,
                projectScope: false,
                unrelated: { keep: true },
            }),
        );
        expect(loadSettings(cwd).defaultLimit).toBe(DEFAULT_SETTINGS.defaultLimit);
        saveSettings(
            { ...DEFAULT_SETTINGS, defaultLimit: 11, autoIndex: false, projectScope: true },
            "project",
            cwd,
        );
        expect(loadSettings(cwd)).toMatchObject({
            defaultLimit: 11,
            autoIndex: false,
            projectScope: true,
        });
        expect(JSON.parse(fs.readFileSync(file, "utf8")).unrelated).toEqual({ keep: true });
        deactivateProjectScope(cwd);
        expect(loadSettings(cwd).projectScope).toBe(false);
        expect(JSON.parse(fs.readFileSync(file, "utf8")).defaultLimit).toBe(11);
    });
    test("malformed and symlink project configs are not overwritten", () => {
        const cwd = root();
        const file = projectConfigFile(cwd);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, "{ malformed");
        expect(() => saveSettings(DEFAULT_SETTINGS, "project", cwd)).toThrow();
        expect(fs.readFileSync(file, "utf8")).toBe("{ malformed");
        fs.rmSync(file);
        const target = path.join(cwd, "outside.json");
        fs.writeFileSync(target, JSON.stringify({ keep: true }));
        fs.symlinkSync(target, file);
        expect(() => saveSettings(DEFAULT_SETTINGS, "project", cwd)).toThrow();
        expect(JSON.parse(fs.readFileSync(target, "utf8"))).toEqual({ keep: true });
        fs.rmSync(file);
        fs.symlinkSync(path.join(cwd, "missing.json"), file);
        expect(() => saveSettings(DEFAULT_SETTINGS, "project", cwd)).toThrow();
    });
});
