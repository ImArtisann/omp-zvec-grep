/**
 * pi-zvec-grep persisted configuration — two layers:
 *
 * - User layer: `~/.pi/agent/pi-zvec-grep/config.json` (via `getAgentDir()`;
 *   `PI_CODING_AGENT_DIR` overridable). Values only — the base defaults for
 *   every workspace that has NOT activated project scope. The user file
 *   never carries a scope flag; legacy keys (`settingsScope`, a stray
 *   `projectScope`) are ignored by readers and stripped on the next
 *   user-layer save.
 * - Project layer: `.zvec-grep/config.json`, anchored at the current working
 *   directory (the same `.zvec-grep` root the workspace index already uses;
 *   no walk-up). Self-contained values plus the boolean activation flag
 *   `projectScope` — true: this file is the whole config for THIS workspace
 *   (built-in defaults + its contents, no user values mixed in, fields
 *   missing from the file falling back to the built-in defaults);
 *   false: the values are stored but dormant and the user layer applies.
 *   Files the menu manages always carry the flag, so a committed file
 *   declares its state explicitly. A repo can only ever flip the settings
 *   of its own workspace, never the machine. (A legacy
 *   `settingsScope: "project"` string in an old project file is honoured
 *   like `projectScope: true`; no other string value activates.)
 *
 * These are the *defaults* used when a tool call doesn't pass an explicit
 * value. Files are read fresh (with a cheap per-file mtime cache) so edits
 * made from the `/zg settings` menu take effect immediately.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir } from "@oh-my-pi/pi-utils";

/**
 * Persistent VALUE fields — both layers store them in full. The user file
 * holds ONLY these fields; the project file holds these fields plus the
 * boolean `projectScope` activation flag.
 */
const OVERRIDABLE_FIELDS = ["defaultLimit", "autoIndex"] as const;
type OverridableField = (typeof OVERRIDABLE_FIELDS)[number];

/** The persistable value fields of the settings object. */
type SettingsValues = Pick<ZvecGrepSettings, OverridableField>;

export interface ZvecGrepSettings {
    /**
     * Effective source for the CURRENT workspace: true when that workspace's
     * project file carries `projectScope: true` (the file alone is
     * authoritative), false otherwise (user layer applies). Derived per
     * workspace; never meaningful in the user file.
     */
    projectScope: boolean;
    /** Default max items per search group (1..50) when a search passes no explicit limit. */
    defaultLimit: number;
    /**
     * On every session start, run `zg status --check-ready` in the working
     * directory; when the index is missing or stale, build/update it in the
     * background (fire-and-forget). Off by default — the first index build can
     * take a while and may download the local embedding model.
     */
    autoIndex: boolean;
}

export const DEFAULT_SETTINGS: ZvecGrepSettings = {
    projectScope: false,
    defaultLimit: 7,
    autoIndex: false,
};

export function userConfigFile(): string {
    return path.join(getAgentDir(), "omp-zvec-grep", "config.json");
}

export function projectConfigFile(projectRoot: string): string {
    return path.resolve(projectRoot, ".zvec-grep", "config.json");
}

function validDefaultLimit(v: unknown): number {
    return typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 50
        ? Math.round(v)
        : DEFAULT_SETTINGS.defaultLimit;
}

interface LayerCacheEntry {
    mtimeMs: number;
    /** Validated known fields actually present in the file (no defaults). */
    partial: Partial<ZvecGrepSettings>;
}

/** Per-file mtime cache: a read is skipped only when the file is unchanged. */
const layerCache = new Map<string, LayerCacheEntry>();

/**
 * Validate the on-disk value of one known field, or return undefined when the
 * field is absent or invalid (invalid falls through to the layer below).
 */
function validField(field: OverridableField, raw: Record<string, unknown>): unknown {
    switch (field) {
        case "defaultLimit":
            return typeof raw[field] === "number" ? validDefaultLimit(raw[field]) : undefined;
        case "autoIndex":
            return typeof raw[field] === "boolean" ? raw[field] : undefined;
    }
}

/**
 * The boolean activation flag: `projectScope` when it is a real boolean; a
 * legacy project-file `settingsScope: "project"` string is honoured as true
 * (read-only compatibility — never written). Anything else → undefined
 * (treated as inactive).
 */
function validScopeFlag(raw: Record<string, unknown>): boolean | undefined {
    if (typeof raw.projectScope === "boolean") return raw.projectScope;
    return raw.settingsScope === "project" ? true : undefined;
}

function validateLayer(raw: unknown): Partial<ZvecGrepSettings> | undefined {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
    const record = raw as Record<string, unknown>;
    const partial: Partial<ZvecGrepSettings> = {};
    const flag = validScopeFlag(record);
    if (flag !== undefined) partial.projectScope = flag;
    for (const field of OVERRIDABLE_FIELDS) {
        const value = validField(field, record);
        if (value !== undefined) (partial as Record<string, unknown>)[field] = value;
    }
    return partial;
}

/**
 * Read one config file (user or project layer) and return the validated
 * fields that are actually present. Missing, unreadable, or invalid files
 * yield a pure default layer (undefined).
 */
function readPartialLayer(file: string): Partial<ZvecGrepSettings> | undefined {
    let mtimeMs: number;
    let text: string;
    try {
        mtimeMs = fs.statSync(file).mtimeMs;
        text = fs.readFileSync(file, "utf8");
    } catch {
        return undefined;
    }
    const cached = layerCache.get(file);
    if (cached && cached.mtimeMs === mtimeMs) return cached.partial;
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return undefined;
    }
    const partial = validateLayer(raw);
    if (partial) layerCache.set(file, { mtimeMs, partial });
    return partial;
}

/**
 * Resolve the effective settings for one workspace.
 *
 * The activation lives in the PROJECT file: when `.zvec-grep/config.json`
 * carries `projectScope: true` (or a legacy `settingsScope: "project"`),
 * that file alone is authoritative for THIS workspace — built-in defaults +
 * its contents, user values never mixed in, fields missing from the file
 * falling back to the built-in defaults. In every other case (no file, flag
 * false/absent/invalid, malformed file) the user file over built-in
 * defaults applies. A project file can therefore only ever flip the
 * settings of its own repo, never the machine.
 */
export function loadSettings(cwd?: string): ZvecGrepSettings {
    const user = { ...DEFAULT_SETTINGS, ...readPartialLayer(userConfigFile()) };
    // The flag is project-file-only; a stray flag in the user file is noise.
    user.projectScope = false;
    if (typeof cwd !== "string" || cwd.length === 0) return user;
    const project = readPartialLayer(projectConfigFile(cwd));
    if (!project?.projectScope) return { ...user, projectScope: false };
    const merged = { ...DEFAULT_SETTINGS, projectScope: true };
    for (const field of OVERRIDABLE_FIELDS) {
        const value = (project as Record<string, unknown>)[field];
        if (value !== undefined) (merged as Record<string, unknown>)[field] = value;
    }
    return merged;
}

/**
 * The stored VALUE fields of the project file (built-in defaults + the
 * file's validated values, flag not included). Lets the settings menu
 * re-activate a dormant file without clobbering its parked values.
 */
export function loadProjectFileValues(projectRoot: string): SettingsValues {
    const project = readPartialLayer(projectConfigFile(projectRoot));
    return {
        defaultLimit:
            typeof project?.defaultLimit === "number"
                ? project.defaultLimit
                : DEFAULT_SETTINGS.defaultLimit,
        autoIndex:
            typeof project?.autoIndex === "boolean"
                ? project.autoIndex
                : DEFAULT_SETTINGS.autoIndex,
    };
}

function readJsonRecord(file: string, strict = false): Record<string, unknown> {
    let stat: fs.Stats;
    try {
        stat = fs.lstatSync(file);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
        throw error;
    }
    if (stat.isSymbolicLink()) throw new Error(`refusing to write symlinked config: ${file}`);
    if (!stat.isFile()) throw new Error(`refusing to write non-file config: ${file}`);
    if (typeof process.getuid === "function" && stat.uid !== process.getuid())
        throw new Error(`refusing config not owned by current user: ${file}`);
    try {
        const raw: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
        if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
            if (strict) throw new Error(`config must contain a JSON object: ${file}`);
            return {};
        }
        return { ...(raw as Record<string, unknown>) };
    } catch (error) {
        if (strict) throw error;
        return {};
    }
}

function assertOwnedProjectRoot(projectRoot: string): string {
    const realRoot = fs.realpathSync(path.resolve(projectRoot));
    const rootStat = fs.statSync(realRoot);
    if (!rootStat.isDirectory()) throw new Error("projectRoot must be a directory");
    if (typeof process.getuid === "function" && rootStat.uid !== process.getuid())
        throw new Error("projectRoot is not owned by current user");
    const directory = path.join(realRoot, ".zvec-grep");
    try {
        const directoryStat = fs.lstatSync(directory);
        if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory())
            throw new Error("refusing to write through an unsafe .zvec-grep path");
        if (fs.realpathSync(directory) !== directory)
            throw new Error("refusing to write through a redirected .zvec-grep path");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const file = path.join(directory, "config.json");
    try {
        const fileStat = fs.lstatSync(file);
        if (fileStat.isSymbolicLink() || !fileStat.isFile())
            throw new Error("refusing to write an unsafe project config");
        if (typeof process.getuid === "function" && fileStat.uid !== process.getuid())
            throw new Error("project config is not owned by current user");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return realRoot;
}
/**
 * Persist a full settings object while preserving unrelated config keys.
 *   also strips legacy/noise keys (`settingsScope`, stray `projectScope`)
 *   from an old user file on the next save.
 * - `project`: writes the values PLUS the boolean `projectScope` flag from
 *   `next` — the file is always self-describing; creates the file and
 *   `.zvec-grep/` dir when missing.
 *
 * `created` is true when a new file was born on disk.
 */
export function saveSettings(
    next: ZvecGrepSettings,
    scope: "user" | "project" = "user",
    projectRoot?: string,
): { file: string; created: boolean } {
    if (scope === "project") {
        if (!projectRoot)
            throw new Error("projectRoot is required to save the project config layer");
        const root = assertOwnedProjectRoot(projectRoot);
        const file = projectConfigFile(root);
        const existed = fs.existsSync(file);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const existing = readJsonRecord(file, true);
        const full: Record<string, unknown> = {
            ...existing,
            ...valuesToFull(next),
            projectScope: next.projectScope,
        };
        fs.writeFileSync(file, JSON.stringify(full, null, 2));
        layerCache.set(file, {
            mtimeMs: fs.statSync(file).mtimeMs,
            partial: validateLayer(full) ?? {},
        });
        return { file, created: !existed };
    }
    const file = userConfigFile();
    const existed = fs.existsSync(file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const existing = readJsonRecord(file);
    const values: Record<string, unknown> = { ...existing, ...valuesToFull(next) };
    delete values.projectScope;
    delete values.settingsScope;
    fs.writeFileSync(file, JSON.stringify(values, null, 2));
    layerCache.set(file, {
        mtimeMs: fs.statSync(file).mtimeMs,
        partial: validateLayer(values) ?? {},
    });
    return { file, created: !existed };
}

/**
 * Turn project scope back off for one workspace while preserving dormant values
 * and unrelated project configuration keys.
 */
export function deactivateProjectScope(projectRoot: string): { changed: boolean } {
    let file: string;
    try {
        file = projectConfigFile(assertOwnedProjectRoot(projectRoot));
    } catch {
        return { changed: false };
    }
    let raw: unknown;
    try {
        raw = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return { changed: false };
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { changed: false };
    const record = raw as Record<string, unknown>;
    if (record.projectScope === false) return { changed: false };
    record.projectScope = false;
    delete record.settingsScope;
    fs.writeFileSync(file, JSON.stringify(record, null, 2));
    layerCache.set(file, {
        mtimeMs: fs.statSync(file).mtimeMs,
        partial: validateLayer(record) ?? {},
    });
    return { changed: true };
}

function valuesToFull(next: ZvecGrepSettings): SettingsValues {
    return { defaultLimit: next.defaultLimit, autoIndex: next.autoIndex };
}
