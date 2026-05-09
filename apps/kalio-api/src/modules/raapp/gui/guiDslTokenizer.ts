export type GuiTokenKind = 'ident' | 'string' | 'number' | 'boolean' | '{' | '}' | '(' | ')' | '=' | ':' | 'eof';

export interface GuiToken {
  kind: GuiTokenKind;
  value?: string;
  pos: number;
}

const isWhitespace = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r';

const isNumberStart = (c: string, next: string | undefined) => {
  if (c >= '0' && c <= '9') return true;
  if (c === '-' && next !== undefined && next >= '0' && next <= '9') return true;
  return false;
};

export function tokenizeGui(src: string): GuiToken[] {
  const tokens: GuiToken[] = [];

  let i = 0;
  if (src.charCodeAt(0) === 0xFEFF) i = 1;

  while (i < src.length) {
    const c = src[i];

    if (isWhitespace(c)) {
      i++;
      continue;
    }

    if (c === '#') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }

    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }

    if (c === '{' || c === '}' || c === '(' || c === ')' || c === '=' || c === ':') {
      tokens.push({ kind: c, pos: i });
      i++;
      continue;
    }

    if (c === '"') {
      const start = i;
      i++;
      let out = '';
      while (i < src.length) {
        const ch = src[i];
        if (ch === '"') {
          i++;
          break;
        }
        if (ch === '\\') {
          const next = src[i + 1];
          if (next === undefined) {
            i++;
            continue;
          }
          switch (next) {
            case 'n':  out += '\n'; break;
            case 'r':  out += '\r'; break;
            case 't':  out += '\t'; break;
            case '\\': out += '\\'; break;
            case '"':  out += '"';  break;
            default:   out += next; break;
          }
          i += 2;
          continue;
        }
        out += ch;
        i++;
      }
      tokens.push({ kind: 'string', value: out, pos: start });
      continue;
    }

    const next = src[i + 1];
    if (isNumberStart(c, next)) {
      const start = i;
      let s = c;
      i++;
      while (i < src.length) {
        const ch = src[i];
        if ((ch >= '0' && ch <= '9') || ch === '.') {
          s += ch;
          i++;
          continue;
        }
        break;
      }
      tokens.push({ kind: 'number', value: s, pos: start });
      continue;
    }

    {
      const start = i;
      let s = '';
      while (i < src.length) {
        const ch = src[i];
        if (isWhitespace(ch) || ch === '{' || ch === '}' || ch === '(' || ch === ')' || ch === '=' || ch === ':' || ch === '"' || ch === '#') break;
        s += ch;
        i++;
      }
      const lower = s.toLowerCase();
      if (lower === 'yes' || lower === 'no') {
        tokens.push({ kind: 'boolean', value: lower, pos: start });
      } else {
        tokens.push({ kind: 'ident', value: s, pos: start });
      }
      continue;
    }
  }

  tokens.push({ kind: 'eof', pos: src.length });
  return tokens;
}
