import { describe, expect, test } from "bun:test";
import {
    createAutoIndexer,
    type AutoIndexExec,
    type AutoIndexExecOptions,
    type AutoIndexExecResult,
} from "../src/extension/lifecycle.ts";

type Notification = { message: string; type: "info" | "error" };

type Call = { args: string[]; options: AutoIndexExecOptions };

const readyResult = (): AutoIndexExecResult => ({
    stdout: "Workspace index is ready",
    stderr: "",
    code: 0,
    killed: false,
});
const missingResult = (): AutoIndexExecResult => ({
    stdout: "No zvec-grep index found",
    stderr: "",
    code: 1,
    killed: false,
});
const staleResult = (): AutoIndexExecResult => ({
    stdout: "Workspace index needs an update",
    stderr: "",
    code: 1,
    killed: false,
});
const successfulIndex = (): AutoIndexExecResult => ({
    stdout: "",
    stderr: "",
    code: 0,
    killed: false,
});

const flush = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
};

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function harness(
    responses: (args: string[]) => Promise<AutoIndexExecResult> | AutoIndexExecResult,
) {
    const calls: Call[] = [];
    const notifications: Notification[] = [];
    const exec: AutoIndexExec = async (args, options) => {
        calls.push({ args: [...args], options });
        return responses(args);
    };
    const autoIndexer = createAutoIndexer(exec);
    const notify = (message: string, type?: "info" | "warning" | "error") => {
        if (type === "info" || type === "error") notifications.push({ message, type });
    };
    return { autoIndexer, calls, notifications, notify };
}

describe("auto-index lifecycle coordinator", () => {
    test("disabled settings do not execute a subprocess and fresh enabled settings start a check", async () => {
        const h = harness(() => readyResult());
        h.autoIndexer.start("/workspace/project", { autoIndex: false }, h.notify);
        await flush();
        expect(h.calls).toHaveLength(0);

        h.autoIndexer.start("/workspace/project", { autoIndex: true }, h.notify);
        await flush();
        expect(h.calls.map(({ args }) => args)).toEqual([["status", "--check-ready"]]);
    });

    test("a ready status performs no build", async () => {
        const h = harness(() => readyResult());
        h.autoIndexer.start("/workspace/project", { autoIndex: true }, h.notify);
        await flush();

        expect(h.calls.map(({ args }) => args)).toEqual([["status", "--check-ready"]]);
        expect(h.notifications).toEqual([]);
    });

    test("missing and stale recognized statuses use incremental index arguments", async () => {
        const missing = harness((args) =>
            args[0] === "status" ? missingResult() : successfulIndex(),
        );
        missing.autoIndexer.start("/workspace/missing", { autoIndex: true }, missing.notify);
        await flush();
        expect(missing.calls.map(({ args }) => args)).toEqual([
            ["status", "--check-ready"],
            ["index", "/workspace/missing"],
        ]);
        expect(missing.calls.some(({ args }) => args.includes("--rebuild"))).toBe(false);
        missing.autoIndexer.shutdown();

        const stale = harness((args) => (args[0] === "status" ? staleResult() : successfulIndex()));
        stale.autoIndexer.start("/workspace/stale", { autoIndex: true }, stale.notify);
        await flush();
        expect(stale.calls.map(({ args }) => args)).toEqual([
            ["status", "--check-ready"],
            ["index", "/workspace/stale"],
        ]);
        expect(stale.calls.some(({ args }) => args.includes("--rebuild"))).toBe(false);
    });

    test("status failures notify and never index", async () => {
        const cases: Array<{ result: AutoIndexExecResult | Error; message: string }> = [
            {
                result: { stdout: "permission denied", stderr: "", code: 2, killed: false },
                message: "permission denied",
            },
            { result: new Error("zg CLI was not found"), message: "zg CLI was not found" },
            {
                result: new Error("readiness check timed out"),
                message: "readiness check timed out",
            },
            {
                result: new Error("readiness check cancelled"),
                message: "readiness check cancelled",
            },
        ];

        for (const [index, scenario] of cases.entries()) {
            const h = harness(() =>
                scenario.result instanceof Error
                    ? Promise.reject(scenario.result)
                    : scenario.result,
            );
            h.autoIndexer.start(`/workspace/failure-${index}`, { autoIndex: true }, h.notify);
            await flush();
            expect(h.calls.map(({ args }) => args)).toEqual([["status", "--check-ready"]]);
            const notification = h.notifications.at(-1);
            expect(notification?.type).toBe("error");
            expect(notification?.message).toContain(scenario.message);
        }
    });

    test("a killed readiness process is operational failure, even with recognizable output", async () => {
        const h = harness(() => ({
            stdout: "No zvec-grep index found",
            stderr: "",
            code: 1,
            killed: true,
        }));
        h.autoIndexer.start("/workspace/killed-status", { autoIndex: true }, h.notify);
        await flush();

        expect(h.calls.map(({ args }) => args)).toEqual([["status", "--check-ready"]]);
        expect(h.notifications).toHaveLength(1);
        expect(h.notifications[0].type).toBe("error");
        expect(h.notifications[0].message).toContain("timed out");
    });

    test("a killed index process is not reported as a successful update", async () => {
        const h = harness((args) =>
            args[0] === "status"
                ? missingResult()
                : { stdout: "", stderr: "", code: 0, killed: true },
        );
        h.autoIndexer.start("/workspace/killed-index", { autoIndex: true }, h.notify);
        await flush();

        expect(h.notifications.at(-1)?.type).toBe("error");
        expect(h.notifications.at(-1)?.message).toContain("timed out");
    });

    test("resolved aliases share one in-flight operation", async () => {
        const status = deferred<AutoIndexExecResult>();
        const index = deferred<AutoIndexExecResult>();
        const h = harness((args) => {
            if (args[0] === "status") return status.promise;
            return index.promise;
        });
        h.autoIndexer.start("/workspace/alias/../project", { autoIndex: true }, h.notify);
        h.autoIndexer.start("/workspace/project", { autoIndex: true }, h.notify);
        await flush();
        expect(h.calls.map(({ args }) => args)).toEqual([["status", "--check-ready"]]);

        status.resolve(missingResult());
        await flush();
        expect(h.calls.map(({ args }) => args)).toEqual([
            ["status", "--check-ready"],
            ["index", "/workspace/project"],
        ]);
        index.resolve(successfulIndex());
        await flush();
    });

    test("failed indexing releases the root so a later start can retry", async () => {
        let indexAttempts = 0;
        const h = harness((args) => {
            if (args[0] === "status") return missingResult();
            indexAttempts += 1;
            return { stdout: "", stderr: "disk full", code: 1, killed: false };
        });

        h.autoIndexer.start("/workspace/retry", { autoIndex: true }, h.notify);
        await flush();
        h.autoIndexer.start("/workspace/retry", { autoIndex: true }, h.notify);
        await flush();

        expect(indexAttempts).toBe(2);
        expect(h.calls.filter(({ args }) => args[0] === "index")).toHaveLength(2);
        expect(h.notifications.filter(({ type }) => type === "error")).toHaveLength(2);
    });

    test("shutdown aborts pending status and prevents follow-on work", async () => {
        const status = deferred<AutoIndexExecResult>();
        const h = harness(() => status.promise);
        h.autoIndexer.start("/workspace/shutdown-status", { autoIndex: true }, h.notify);
        await flush();
        const statusSignal = h.calls[0].options.signal;

        h.autoIndexer.shutdown();
        expect(statusSignal.aborted).toBe(true);
        status.resolve(missingResult());
        await flush();
        h.autoIndexer.start("/workspace/shutdown-status", { autoIndex: true }, h.notify);
        await flush();

        expect(h.calls.map(({ args }) => args)).toEqual([["status", "--check-ready"]]);
        expect(h.notifications).toEqual([]);
    });

    test("shutdown aborts pending index and suppresses completion output", async () => {
        const index = deferred<AutoIndexExecResult>();
        const h = harness((args) => (args[0] === "status" ? missingResult() : index.promise));
        h.autoIndexer.start("/workspace/shutdown-index", { autoIndex: true }, h.notify);
        await flush();
        const indexSignal = h.calls[1].options.signal;

        h.autoIndexer.shutdown();
        expect(indexSignal.aborted).toBe(true);
        index.resolve(successfulIndex());
        await flush();

        expect(h.calls.map(({ args }) => args)).toEqual([
            ["status", "--check-ready"],
            ["index", "/workspace/shutdown-index"],
        ]);
        expect(h.notifications.filter(({ message }) => message.includes("updated"))).toEqual([]);
    });
});
