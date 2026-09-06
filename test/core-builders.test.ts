import { describe, expect, test } from "bun:test";
import { buildIndexArgs } from "../src/core/indexing.ts";
import { buildQueryArgs, DEFAULT_LIMIT } from "../src/core/queries.ts";
import { clip, normalizeRoot } from "../src/core/workspace.ts";

describe("zvec query argv contract", () => {
    test("preserves groups routes filters and limits", () => {
        const args: string[] = buildQueryArgs({
            query: "primary",
            queries: ["q1", "q2"],
            fts: ["AuthService"],
            vector: ["semantic"],
            fuse: true,
            limit: 42,
            globs: ["src/**", "!gen/**"],
            fileTypes: ["ts", "py"],
            excludedFileTypes: ["svg"],
            symbolTypes: ["function"],
            preferSymbol: true,
            modifiedAfter: "2026-01-01",
            modifiedBefore: "2026-07-01",
        });
        expect(args.slice(0, 2)).toEqual(["query", "primary"]);
        expect(args).toContain("--hybrid");
        expect(args).toContain("--fts");
        expect(args).toContain("--vector");
        expect(args).toContain("--fuse");
        expect(args).toContain("--prefer-symbol");
        expect(args).toContain("--modified-after");
        expect(args).toContain("--modified-before");
        expect(args[args.indexOf("--limit") + 1]).toBe("42");
        expect(args.filter((_, i) => args[i - 1] === "-g")).toEqual(["src/**", "!gen/**"]);
    });
    test("requires a query group and supports vector-only", () => {
        expect(() => buildQueryArgs({})).toThrow("at least one of");
        const vectorArgs: string[] = buildQueryArgs({ vector: ["meaning-only"] });
        expect(vectorArgs[1]).toBe("--vector");
        expect(DEFAULT_LIMIT).toBe(7);
    });
});

describe("zvec index argv contract", () => {
    test("supports update rebuild drop embedding filters and hidden", () => {
        expect(buildIndexArgs({ root: "/w" }, "/w")).toEqual(["index", "/w"]);
        expect(
            buildIndexArgs(
                {
                    root: "/w",
                    mode: "rebuild",
                    embedding: "local/x",
                    globs: ["src/**"],
                    fileTypes: ["ts"],
                    excludedFileTypes: ["svg"],
                    hidden: true,
                },
                "/w",
            ),
        ).toEqual([
            "index",
            "/w",
            "--rebuild",
            "--embedding",
            "local/x",
            "-g",
            "src/**",
            "-t",
            "ts",
            "-T",
            "svg",
            "--hidden",
        ]);
        expect(buildIndexArgs({ root: "/w", mode: "drop" }, "/w")).toEqual([
            "index",
            "/w",
            "--drop",
            "--yes",
        ]);
    });
});

describe("workspace path/output contract", () => {
    test("normalizes roots and clips output", () => {
        expect(normalizeRoot(undefined, "/cwd")).toBe("/cwd");
        expect(normalizeRoot("@sub", "/cwd")).toBe("/cwd/sub");
        expect(clip("short")).toBe("short");
        const longText: string = Array.from({ length: 10 }, () => "x").join("");
        expect(clip(longText, 5)).toContain("truncated");
    });
});
