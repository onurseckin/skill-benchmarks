import { dlopen, FFIType, ptr } from "bun:ffi";

const libraryPath = process.platform === "darwin" ? "/usr/lib/libSystem.B.dylib" : "libc.so.6";
const directoryEntryLibrary = dlopen(libraryPath, {
  openat: {
    args: [FFIType.i32, FFIType.ptr, FFIType.i32, FFIType.i32],
    returns: FFIType.i32,
  },
  linkat: {
    args: [FFIType.i32, FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.i32],
    returns: FFIType.i32,
  },
  unlinkat: {
    args: [FFIType.i32, FFIType.ptr, FFIType.i32],
    returns: FFIType.i32,
  },
});

export function openDirectoryEntry(
  directoryDescriptor: number,
  entryName: string,
  flags: number,
  mode: number = 0
): number {
  const entry = createEntryName(entryName);
  const descriptor = directoryEntryLibrary.symbols.openat(directoryDescriptor, ptr(entry), flags, mode);
  if (descriptor < 0) throw new TypeError("Owned directory entry open failed");
  return descriptor;
}

export function linkDirectoryEntry(
  directoryDescriptor: number,
  sourceName: string,
  targetName: string
): void {
  const source = createEntryName(sourceName);
  const target = createEntryName(targetName);
  const result = directoryEntryLibrary.symbols.linkat(
    directoryDescriptor,
    ptr(source),
    directoryDescriptor,
    ptr(target),
    0
  );
  if (result !== 0) throw new TypeError("Owned directory entry publication failed");
}

export function unlinkDirectoryEntry(directoryDescriptor: number, entryName: string): void {
  const entry = createEntryName(entryName);
  const result = directoryEntryLibrary.symbols.unlinkat(directoryDescriptor, ptr(entry), 0);
  if (result !== 0) throw new TypeError("Owned directory entry removal failed");
}

function createEntryName(value: string): Buffer {
  if (value.length === 0 || value === "." || value === ".." || value.includes("/") || value.includes("\0")) {
    throw new TypeError("Owned directory entry name is unsafe");
  }
  return Buffer.from(`${value}\0`);
}
