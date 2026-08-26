import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createZip, crc32 } from "../scripts/zip.mjs";

/** A minimal reader, so the test verifies the archive rather than trusting it. */
function readZip(archive: Buffer): { name: string; data: Buffer }[] {
  const end = archive.length - 22;
  expect(archive.readUInt32LE(end)).toBe(0x06054b50);
  const count = archive.readUInt16LE(end + 10);
  let offset = archive.readUInt32LE(end + 16);

  const entries: { name: string; data: Buffer }[] = [];
  for (let i = 0; i < count; i += 1) {
    expect(archive.readUInt32LE(offset)).toBe(0x02014b50);
    const method = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const nameLength = archive.readUInt16LE(offset + 28);
    const localOffset = archive.readUInt32LE(offset + 42);
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");

    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const extraLength = archive.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + extraLength;
    const raw = archive.subarray(start, start + compressedSize);

    entries.push({ name, data: method === 8 ? inflateRawSync(raw) : raw });
    offset += 46 + nameLength;
  }
  return entries;
}

describe("crc32", () => {
  it("matches the known checksum of a known string", () => {
    expect(crc32(Buffer.from("The quick brown fox jumps over the lazy dog"))).toBe(0x414fa339);
    expect(crc32(Buffer.from(""))).toBe(0);
  });
});

describe("createZip", () => {
  it("round-trips file contents", () => {
    const entries = [
      { name: "manifest.json", data: Buffer.from('{"manifest_version":3}') },
      { name: "icons/icon.svg", data: Buffer.from("<svg></svg>") },
    ];
    const read = readZip(createZip(entries));
    expect(read.map((entry) => entry.name)).toEqual(["icons/icon.svg", "manifest.json"]);
    expect(read[1]?.data.toString()).toBe('{"manifest_version":3}');
  });

  it("compresses when that is smaller, and stores when it is not", () => {
    const compressible = Buffer.alloc(4096, 97);
    const tiny = Buffer.from("x");
    const archive = createZip([
      { name: "big.txt", data: compressible },
      { name: "tiny.txt", data: tiny },
    ]);
    expect(archive.length).toBeLessThan(compressible.length);
    const read = readZip(archive);
    expect(read.find((entry) => entry.name === "big.txt")?.data.length).toBe(4096);
    expect(read.find((entry) => entry.name === "tiny.txt")?.data.toString()).toBe("x");
  });

  it("produces identical bytes for identical input", () => {
    const entries = [{ name: "a.txt", data: Buffer.from("hello") }];
    expect(createZip(entries).equals(createZip(entries))).toBe(true);
  });

  it("does not depend on the order it was given the files", () => {
    const first = { name: "a.txt", data: Buffer.from("a") };
    const second = { name: "b.txt", data: Buffer.from("b") };
    expect(createZip([first, second]).equals(createZip([second, first]))).toBe(true);
  });

  it("writes a fixed timestamp, so the clock cannot change the output", () => {
    const archive = createZip([{ name: "a.txt", data: Buffer.from("a") }]);
    expect(archive.readUInt16LE(10)).toBe(0);
    expect(archive.readUInt16LE(12)).toBe((0 << 9) | (1 << 5) | 1);
  });

  it("writes an empty archive rather than failing", () => {
    expect(readZip(createZip([]))).toEqual([]);
  });
});
