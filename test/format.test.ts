import { describe, expect, test } from "bun:test";
import {
    hitHeadline,
    parseIndexOutput,
    parseSearchOutput,
    parseStatusVerdict,
} from "../src/core/format.ts";

describe("zg output parsers", () => {
    test("parses ranked hits, groups, files, labels, stale state, and previews", () => {
        const lines: string[] = [
            "query groups (1):",
            "Q1 [primary]: auth",
            "hits: 2",
            "",
            "#1 matchedBy=fts+vector src/auth.ts:3-4",
            "heading: validateToken",
            "status: possibly_stale",
            "3\tvalidate token",
            "",
            "#2 src/other.ts:8",
            "8\tother",
            "",
        ];
        const parsed = parseSearchOutput(lines.join("\n"));
        expect(parsed).toMatchObject({ totalHits: 2, fileCount: 2, hasStale: true });
        expect(parsed?.top).toMatchObject({
            rank: 1,
            matchedBy: "fts+vector",
            file: "src/auth.ts:3-4",
            label: "validateToken",
            preview: "validate token",
            status: "possibly_stale",
        });
    });
    test("handles multi-group, zero-hit, malformed, and headline precedence", () => {
        const lines: string[] = [
            "query groups (2):",
            "Q1 [primary]: first",
            "hits: 2",
            "",
            "#1 matchedBy=fts file-a.ts:1",
            "1\tfirst",
            "",
            "#2 file-b.ts:2",
            "status: possibly_stale",
            "symbol: fn",
            "2\tsecond",
            "",
            "Q2 [supplemental]: second",
            "hits: 1",
            "",
            "#1 file-a.ts:3",
            "3\tthird",
        ];
        const parsed = parseSearchOutput(lines.join("\n"));
        expect(parsed).toMatchObject({ totalHits: 3, fileCount: 2, hasStale: true });
        expect(parsed?.groups).toHaveLength(2);
        expect(parsed?.groups[1]?.role).toBe("supplemental");
        expect(parseSearchOutput("query groups (1):\nQ1 [primary]: none\nhits: 0")).toMatchObject({
            totalHits: 0,
        });
        expect(parseSearchOutput("")).toBeUndefined();
        expect(parseSearchOutput("Error: no index\nCode: X")).toBeUndefined();
        expect(hitHeadline({ rank: 1, file: "a.ts:1", label: "heading", preview: "preview" })).toBe(
            "a.ts:1 — heading",
        );
        const longPreview: string = Array.from({ length: 80 }, () => "x").join("");
        expect(hitHeadline({ rank: 1, preview: longPreview })).toEndWith("…");
    });
    test("parses status verdicts and index completion counters", () => {
        expect(parseStatusVerdict("Workspace index is ready")?.line).toBe("index ready");
        expect(
            parseStatusVerdict(
                "Workspace index needs an update\nChanges 1 added · 2 modified · 3 deleted",
            )?.line,
        ).toContain("1 added");
        expect(parseStatusVerdict("Workspace index is not configured")?.kind).toBe("missing");
        expect(
            parseStatusVerdict("Error: No zvec-grep index found\nCode: WORKSPACE_INDEX_NOT_FOUND")
                ?.kind,
        ).toBe("missing");
        expect(parseStatusVerdict("brand new unknown format")).toBeUndefined();
        const index = parseIndexOutput(
            "Workspace index\nfiles\t20 scanned, 2 added, 3 modified, 0 retried, 15 unchanged, 0 deleted, 0 failed\nentities\t36\nduration\t2s (1735ms)",
        );
        expect(index).toMatchObject({
            scanned: 20,
            added: 2,
            modified: 3,
            unchanged: 15,
            entities: 36,
            duration: "2s",
        });
        expect(parseIndexOutput("Index removed")).toBeUndefined();
    });
});
