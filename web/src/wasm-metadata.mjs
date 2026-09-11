// Narrow, fail-closed WebAssembly metadata reader for the local-cart profile.
// WebAssembly.compile remains the structural validator. This reader exposes
// the information that WebAssembly.Module reflection omits: signatures and
// declared table/memory bounds.

const utf8 = new TextDecoder("utf-8", { fatal: true });
const VALUE_TYPES = new Set([0x7f, 0x7e, 0x7d, 0x7c, 0x7b, 0x70, 0x6f]);

class Reader {
  constructor(bytes, end = bytes.length) {
    this.bytes = bytes;
    this.pos = 0;
    this.end = end;
  }

  fail(message) { throw new Error(`Invalid WebAssembly module: ${message}`); }

  byte() {
    if (this.pos >= this.end) this.fail("unexpected end of file");
    return this.bytes[this.pos++];
  }

  u32() {
    let value = 0;
    let shift = 0;
    for (let i = 0; i < 5; i++) {
      const byte = this.byte();
      value += (byte & 0x7f) * (2 ** shift);
      if ((byte & 0x80) === 0) {
        if (value > 0xffff_ffff) this.fail("u32 value is out of range");
        return value;
      }
      shift += 7;
    }
    this.fail("u32 encoding is too long");
  }

  name() {
    const length = this.u32();
    const end = this.pos + length;
    if (end > this.end) this.fail("string extends past its section");
    let value;
    try { value = utf8.decode(this.bytes.subarray(this.pos, end)); }
    catch (_) { this.fail("name is not valid UTF-8"); }
    this.pos = end;
    return value;
  }

  vector(readItem) {
    const count = this.u32();
    const items = [];
    for (let i = 0; i < count; i++) items.push(readItem());
    return items;
  }

  subreader(length) {
    const end = this.pos + length;
    if (end > this.end) this.fail("section extends past end of file");
    const child = new Reader(this.bytes, end);
    child.pos = this.pos;
    this.pos = end;
    return child;
  }

  finish(label) {
    if (this.pos !== this.end) this.fail(`${label} has trailing bytes`);
  }
}

function valueType(reader) {
  const type = reader.byte();
  if (!VALUE_TYPES.has(type)) reader.fail(`unsupported value type 0x${type.toString(16)}`);
  return type;
}

function limits(reader) {
  const flags = reader.u32();
  if (flags !== 0 && flags !== 1) {
    reader.fail(`unsupported limits flags 0x${flags.toString(16)}`);
  }
  const initial = reader.u32();
  const maximum = flags === 1 ? reader.u32() : null;
  return { initial, maximum, shared: false, memory64: false };
}

function tableType(reader) {
  const element = valueType(reader);
  if (element !== 0x70 && element !== 0x6f) reader.fail("invalid table reference type");
  return { element, ...limits(reader) };
}

function memoryType(reader) { return limits(reader); }

function globalType(reader) {
  const value = valueType(reader);
  const mutable = reader.byte();
  if (mutable > 1) reader.fail("invalid global mutability");
  return { value, mutable: mutable === 1 };
}

export function readWasmMetadata(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const reader = new Reader(bytes);
  const expected = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
  for (const byte of expected) {
    if (reader.byte() !== byte) reader.fail("bad magic or unsupported version");
  }

  const metadata = {
    types: [], imports: [], functionTypes: [], tables: [], memories: [], exports: [], start: null,
  };
  const importedFunctionTypes = [];

  while (reader.pos < reader.end) {
    const id = reader.byte();
    const section = reader.subreader(reader.u32());
    if (id === 0) continue;
    if (id === 1) {
      metadata.types = section.vector(() => {
        if (section.byte() !== 0x60) section.fail("unsupported non-function type");
        return {
          params: section.vector(() => valueType(section)),
          results: section.vector(() => valueType(section)),
        };
      });
    } else if (id === 2) {
      metadata.imports = section.vector(() => {
        const module = section.name();
        const name = section.name();
        const kind = section.byte();
        let descriptor;
        if (kind === 0) {
          descriptor = { typeIndex: section.u32() };
          importedFunctionTypes.push(descriptor.typeIndex);
        } else if (kind === 1) descriptor = tableType(section);
        else if (kind === 2) descriptor = memoryType(section);
        else if (kind === 3) descriptor = globalType(section);
        else section.fail(`unsupported import kind ${kind}`);
        return { module, name, kind, ...descriptor };
      });
    } else if (id === 3) {
      metadata.functionTypes = section.vector(() => section.u32());
    } else if (id === 4) {
      metadata.tables = section.vector(() => tableType(section));
    } else if (id === 5) {
      metadata.memories = section.vector(() => memoryType(section));
    } else if (id === 7) {
      metadata.exports = section.vector(() => ({
        name: section.name(), kind: section.byte(), index: section.u32(),
      }));
    } else if (id === 8) {
      metadata.start = section.u32();
    } else {
      section.pos = section.end;
    }
    section.finish(`section ${id}`);
  }

  const allFunctionTypes = [...importedFunctionTypes, ...metadata.functionTypes];
  for (const entry of metadata.imports) {
    if (entry.kind !== 0) continue;
    entry.signature = metadata.types[entry.typeIndex];
    if (!entry.signature) reader.fail(`import ${entry.module}.${entry.name} has an invalid type index`);
  }
  for (const entry of metadata.exports) {
    if (entry.kind === 0) {
      const typeIndex = allFunctionTypes[entry.index];
      entry.signature = metadata.types[typeIndex];
      if (!entry.signature) reader.fail(`export ${entry.name} has an invalid function index`);
    } else if (entry.kind === 2) {
      entry.memory = metadata.memories[entry.index];
      if (!entry.memory) reader.fail(`export ${entry.name} has an invalid memory index`);
    }
  }
  if (metadata.start !== null && !metadata.types[allFunctionTypes[metadata.start]]) {
    reader.fail("start section has an invalid function index");
  }
  return metadata;
}
