// Archivi senza dipendenze (solo zlib di Node), usati da build-zip.mjs (zip HTML5 per itch.io) e build-win.mjs
// (build Windows con Neutralino): zip con deflate e percorsi separati da "/" (richiesto dai server Linux come
// quello di itch.io), lettura degli zip semplici (stored/deflate, senza zip64) per estrarre file scaricati,
// archivi ASAR (resources.neu di Neutralino) in scrittura e in lettura (questa per i test).

import zlib from 'node:zlib';

/** Data e ora in formato DOS. */
function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/** Zip in memoria da entries = [{ name: 'a/b.txt', data: Buffer, mtime: Date }] (nell'ordine dato). */
export function zipBuffer(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name: rel, data, mtime } of entries) {
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    // file già compressi (png) o piccoli: "store" se il deflate non conviene
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const crc = zlib.crc32(data);
    const name = Buffer.from(rel, 'utf8');
    const { time, date } = dosTime(mtime || new Date());

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versione necessaria
    local.writeUInt16LE(0x0800, 6); // nomi in UTF-8
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // creato da
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }
  const centralSize = centrals.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/** Legge uno zip (stored o deflate): Map nome -> Buffer. */
export function unzipBuffer(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip file (end of central directory not found)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Bad zip central directory');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue; // cartella
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const body = buf.subarray(start, start + csize);
    if (method === 0) out.set(name, Buffer.from(body));
    else if (method === 8) out.set(name, zlib.inflateRawSync(body));
    else throw new Error(`Unsupported zip compression ${method} for ${name}`);
  }
  return out;
}

/**
 * Archivio ASAR da files = [{ name: 'a/b.txt', data }]: [UInt32 4][UInt32 dimensione header] + header (pickle:
 * UInt32 dimensione payload, UInt32 lunghezza JSON, JSON, padding a 4 byte) + contenuti dei file in fila.
 * Nel JSON ogni cartella è { files: {...} }, ogni file { size, offset } con offset (stringa) dall'inizio dei dati.
 */
export function asarBuffer(files) {
  const tree = { files: {} };
  let offset = 0;
  for (const f of files) {
    const parts = f.name.split('/');
    let dir = tree;
    for (const p of parts.slice(0, -1)) dir = dir.files[p] ??= { files: {} };
    dir.files[parts.at(-1)] = { size: f.data.length, offset: String(offset) };
    offset += f.data.length;
  }
  const json = Buffer.from(JSON.stringify(tree), 'utf8');
  const pad = (4 - (json.length % 4)) % 4;
  const header = Buffer.alloc(8 + json.length + pad);
  header.writeUInt32LE(4 + json.length + pad, 0); // payload del pickle
  header.writeUInt32LE(json.length, 4);
  json.copy(header, 8);
  const size = Buffer.alloc(8);
  size.writeUInt32LE(4, 0);
  size.writeUInt32LE(header.length, 4);
  return Buffer.concat([size, header, ...files.map((f) => f.data)]);
}

/** Legge un archivio ASAR: Map percorso ('a/b.txt') -> Buffer. */
export function unasarBuffer(buf) {
  const headerSize = buf.readUInt32LE(4);
  const json = buf.toString('utf8', 16, 16 + buf.readUInt32LE(12));
  const base = 8 + headerSize;
  const out = new Map();
  const walk = (node, prefix) => {
    for (const [name, e] of Object.entries(node.files)) {
      const p = prefix ? `${prefix}/${name}` : name;
      if (e.files) walk(e, p);
      else out.set(p, buf.subarray(base + Number(e.offset), base + Number(e.offset) + e.size));
    }
  };
  walk(JSON.parse(json), '');
  return out;
}
