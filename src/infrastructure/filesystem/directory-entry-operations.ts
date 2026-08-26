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
  renameat: {
    args: [FFIType.i32, FFIType.ptr, FFIType.i32, FFIType.ptr],
    returns: FFIType.i32,
  },
});
const renameDirectoryEntry = createRenameDirectoryEntry();

export function openDirectoryEntry(
  directoryDescriptor: number,
  entryName: string,
  flags: number,
  mode: number = 0,
): number {
  const descriptor = tryOpenDirectoryEntry(directoryDescriptor, entryName, flags, mode);
  if (descriptor === undefined) throw new TypeError("Owned directory entry open failed");
  return descriptor;
}

export function tryOpenDirectoryEntry(
  directoryDescriptor: number,
  entryName: string,
  flags: number,
  mode: number = 0,
): number | undefined {
  const entry = createEntryName(entryName);
  const descriptor = directoryEntryLibrary.symbols.openat(
    directoryDescriptor,
    ptr(entry),
    flags,
    mode,
  );
  return descriptor < 0 ? undefined : descriptor;
}

export function linkDirectoryEntry(
  directoryDescriptor: number,
  sourceName: string,
  targetName: string,
): void {
  const source = createEntryName(sourceName);
  const target = createEntryName(targetName);
  const result = directoryEntryLibrary.symbols.linkat(
    directoryDescriptor,
    ptr(source),
    directoryDescriptor,
    ptr(target),
    0,
  );
  if (result !== 0) throw new TypeError("Owned directory entry publication failed");
}

export function unlinkDirectoryEntry(directoryDescriptor: number, entryName: string): void {
  const entry = createEntryName(entryName);
  const result = directoryEntryLibrary.symbols.unlinkat(directoryDescriptor, ptr(entry), 0);
  if (result !== 0) throw new TypeError("Owned directory entry removal failed");
}

export function renameDirectoryEntryNoReplace(
  directoryDescriptor: number,
  sourceName: string,
  targetName: string,
): void {
  const source = createEntryName(sourceName);
  const target = createEntryName(targetName);
  const result = renameDirectoryEntry(directoryDescriptor, source, target);
  if (result !== 0) throw new TypeError("Owned directory entry quarantine failed");
}

export function replaceDirectoryEntry(
  directoryDescriptor: number,
  sourceName: string,
  targetName: string,
): void {
  const source = createEntryName(sourceName);
  const target = createEntryName(targetName);
  const result = directoryEntryLibrary.symbols.renameat(
    directoryDescriptor,
    ptr(source),
    directoryDescriptor,
    ptr(target),
  );
  if (result !== 0) throw new TypeError("Owned directory entry replacement failed");
}

function createRenameDirectoryEntry(): (
  descriptor: number,
  source: Buffer,
  target: Buffer,
) => number {
  if (process.platform === "darwin") {
    const library = dlopen(libraryPath, {
      renameatx_np: {
        args: [FFIType.i32, FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.u32],
        returns: FFIType.i32,
      },
    });
    return (descriptor, source, target) =>
      library.symbols.renameatx_np(descriptor, ptr(source), descriptor, ptr(target), 4);
  }
  const library = dlopen(libraryPath, {
    renameat2: {
      args: [FFIType.i32, FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.u32],
      returns: FFIType.i32,
    },
  });
  return (descriptor, source, target) =>
    library.symbols.renameat2(descriptor, ptr(source), descriptor, ptr(target), 1);
}

function createEntryName(value: string): Buffer {
  if (
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\0")
  ) {
    throw new TypeError("Owned directory entry name is unsafe");
  }
  return Buffer.from(`${value}\0`);
}
