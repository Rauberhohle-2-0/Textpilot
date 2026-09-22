import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Logger } from "../../src/logging/logger.ts";
import type { LogEntry } from "../../src/logging/logger.ts";
import type { Transport } from "../../src/logging/transport.ts";
import { format } from "../../src/logging/format.ts";
import { ConsoleTransport } from "../../src/logging/transports/console.ts";
import { FileTransport } from "../../src/logging/transports/file.ts";

/** A transport that keeps entries in memory - for asserting on logs. */
class MemoryTransport implements Transport {
  readonly name = "memory";
  readonly entries: LogEntry[] = [];

  write(entry: LogEntry): void {
    this.entries.push(entry);
  }
}

function tempFile(): string {
  return join(mkdtempSync(join(tmpdir(), "textpilot-test-")), "run.log");
}

describe("logger core", () => {
  test("delivers entries to every transport", () => {
    const memory = new MemoryTransport();
    const seen: LogEntry[] = [];
    const other: Transport = { name: "other", write: (entry) => seen.push(entry) };

    const logger = new Logger({ transports: [memory, other] });
    logger.info("hello", { answer: 42 });

    expect(memory.entries).toHaveLength(1);
    expect(seen).toHaveLength(1);
    expect(memory.entries[0]).toMatchObject({
      level: "info",
      message: "hello",
      data: { answer: 42 },
    });
  });

  test("filters below the configured level", () => {
    const memory = new MemoryTransport();
    const logger = new Logger({ level: "warn", transports: [memory] });

    logger.debug("quiet");
    logger.info("normal");
    logger.warn("loud");
    logger.error("louder");

    expect(memory.entries.map((entry) => entry.level)).toEqual(["warn", "error"]);
  });

  test("child loggers prefix the scope", () => {
    const memory = new MemoryTransport();
    const logger = new Logger({ transports: [memory] });

    logger.child("server").child("requests").info("scoped");

    expect(memory.entries[0]?.scope).toBe("server:requests");
  });

  test("a failing transport does not break the others", () => {
    const memory = new MemoryTransport();
    const broken: Transport = {
      name: "broken",
      write: () => {
        throw new Error("disk on fire");
      },
    };

    const logger = new Logger({ transports: [broken, memory] });
    logger.info("still delivered");

    expect(memory.entries).toHaveLength(1);
  });

  test("close is passed to the transports", () => {
    let closed = 0;
    const transport: Transport = { name: "x", write: () => {}, close: () => void closed++ };

    new Logger({ transports: [transport] }).close();
    expect(closed).toBe(1);
  });
});

describe("console transport", () => {
  test("formats time, level, scope and data onto one line", () => {
    const entry: LogEntry = {
      time: new Date("2026-09-14T10:00:00Z"),
      level: "info",
      message: "served",
      scope: "server",
      data: { status: 200 },
    };
    expect(format(entry)).toBe(
      '2026-09-14T10:00:00.000Z INFO  [server] served {"status":200}',
    );
  });
});

describe("file transport", () => {
  test("appends entries as lines", () => {
    const path = tempFile();
    const transport = new FileTransport({ path });
    const logger = new Logger({ transports: [transport] });

    logger.info("first");
    logger.warn("second");
    logger.close();

    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("INFO");
    expect(lines[0]).toContain("first");
    expect(lines[1]).toContain("WARN");
    expect(lines[1]).toContain("second");

    rmSync(join(path, ".."), { recursive: true, force: true });
  });

  test("truncate empties the file from the previous run", () => {
    const path = tempFile();
    const first = new Logger({
      transports: [new FileTransport({ path, truncate: true })],
    });
    first.info("from the last run");
    first.close();

    const second = new Logger({
      transports: [new FileTransport({ path, truncate: true })],
    });
    second.info("from this run");
    second.close();

    const content = readFileSync(path, "utf8");
    expect(content).toContain("from this run");
    expect(content).not.toContain("from the last run");

    rmSync(join(path, ".."), { recursive: true, force: true });
  });
});

describe("console transport output", () => {
  test("writes info to stdout and errors to stderr", () => {
    const transport = new ConsoleTransport();
    const logs: { stream: string; text: string }[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (line: string) => logs.push({ stream: "out", text: line });
    console.error = (line: string) => logs.push({ stream: "err", text: line });
    try {
      transport.write({
        time: new Date(),
        level: "info",
        message: "to stdout",
      });
      transport.write({
        time: new Date(),
        level: "error",
        message: "to stderr",
      });
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
    expect(logs[0]).toMatchObject({ stream: "out" });
    expect(logs[1]).toMatchObject({ stream: "err" });
  });
});
