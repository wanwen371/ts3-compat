// TS3 command-line syntax: escaping, serialisation and parsing.
//
//   "sendtextmessage targetmode=2 msg=hello\\sworld"
//
// Escapes (both directions, see docs/protocol.md §11.4 and the ServerQuery
// docs): \\ \/ \s \p \a \b \f \n \r \t \v.
// Responses are either a command line ("name key=value ...") or nameless rows
// ("clid=1 cid=2|clid=3 cid=4"); rows and notify batches are handled by
// splitRows.

const ESCAPE = Object.freeze({
  '\\': '\\\\',
  '/': '\\/',
  ' ': '\\s',
  '|': '\\p',
  '\x07': '\\a',
  '\b': '\\b',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\v': '\\v',
});

const UNESCAPE = Object.freeze({
  '\\': '\\',
  '/': '/',
  s: ' ',
  p: '|',
  a: '\x07',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
});

export function escapeValue(value) {
  const s = String(value ?? '');
  let out = '';
  for (const ch of s) out += ESCAPE[ch] ?? ch;
  return out;
}

export function unescapeValue(value) {
  const s = String(value ?? '');
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && i + 1 < s.length) {
      const next = s[i + 1];
      out += UNESCAPE[next] ?? next;
      i++;
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Serialise a command. Parameters may be an object (insertion order preserved)
 * or an array of [key, value] pairs; a key starting with "-" and an empty
 * value becomes a bare flag.
 */
export function encodeCommand(name, params = {}) {
  const pairs = Array.isArray(params) ? params : Object.entries(params ?? {});
  let line = escapeValue(name);
  for (const [key, value] of pairs) {
    if (key.startsWith('-') && (value === '' || value === undefined || value === null)) {
      line += ` ${key}`;
      continue;
    }
    line += ` ${key}=${escapeValue(value)}`;
  }
  return Buffer.from(line, 'utf8');
}

/** Parse one command line into its name, parameters and bare flags. */
export function parseCommand(buf) {
  const line = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf ?? '');
  const result = { name: '', params: {}, flags: [], raw: line };
  let rest = line.replace(/^[\u0000-\u001f]+/, '');
  if (rest === '') return result;

  const space = rest.indexOf(' ');
  const head = space === -1 ? rest : rest.slice(0, space);
  if (isCommandName(head)) {
    result.name = head;
    rest = space === -1 ? '' : rest.slice(space + 1);
  }

  for (const token of rest.split(' ')) {
    if (token === '') continue;
    const eq = token.indexOf('=');
    if (eq === -1) {
      // A bare token: "-away"-style flag, or a nameless response marker.
      result.flags.push(unescapeValue(token));
      continue;
    }
    const key = unescapeValue(token.slice(0, eq));
    const value = unescapeValue(token.slice(eq + 1));
    if (key === '') continue;
    result.params[key] = value;
  }
  return result;
}

/** True for a run of ASCII alphanumerics/underscores, i.e. a command name. */
export function isCommandName(token) {
  if (!token) return false;
  for (let i = 0; i < token.length; i++) {
    const c = token.charCodeAt(i);
    const ok =
      (c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a) || (c >= 0x30 && c <= 0x39) || c === 0x5f;
    if (!ok) return false;
  }
  return true;
}

/**
 * Split a multi-row line into rows. TeamSpeak compresses a batch by leaving out
 * fields whose value did not change from the previous row, so later rows are
 * merged with the fields of the row before them.
 *
 * @param {string} line
 * @returns {{name: string, rows: Array<Record<string,string>>}}
 */
export function splitRows(line) {
  const text = String(line ?? '');
  const space = text.indexOf(' ');
  let name = '';
  let body = text;
  if (space !== -1 && isCommandName(text.slice(0, space))) {
    name = text.slice(0, space);
    body = text.slice(space + 1);
  } else if (space === -1 && isCommandName(text)) {
    name = text;
    body = '';
  }
  const parts = body.split('|');
  const rows = [];
  let previous = [];
  for (const part of parts) {
    const own = part.split(' ').filter((t) => t !== '');
    const named = new Set(own.map((t) => fieldName(t)));
    const merged = [];
    for (const token of previous) {
      if (!named.has(fieldName(token))) merged.push(token);
    }
    for (const token of own) merged.push(token);
    const row = {};
    for (const token of merged) {
      const eq = token.indexOf('=');
      if (eq === -1) {
        row[unescapeValue(token)] = '';
      } else {
        row[unescapeValue(token.slice(0, eq))] = unescapeValue(token.slice(eq + 1));
      }
    }
    if (Object.keys(row).length > 0 || own.length === 0) rows.push(row);
    previous = merged;
  }
  return { name, rows };
}

function fieldName(token) {
  const eq = token.indexOf('=');
  return eq === -1 ? token : token.slice(0, eq);
}

/** Parse the "error id=.. msg=.." line the server answers a command with. */
export function parseError(line) {
  const cmd = parseCommand(line);
  if (cmd.name !== 'error') return null;
  return {
    id: Number.parseInt(cmd.params.id ?? '0', 10) || 0,
    message: cmd.params.msg ?? '',
    raw: cmd.params,
  };
}

/** Convert TS3 numeric params defensively. */
export function toInt(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : fallback;
}

export function toBool(value) {
  return value === '1' || value === 'true';
}

export default { encodeCommand, parseCommand, splitRows, escapeValue, unescapeValue, parseError };