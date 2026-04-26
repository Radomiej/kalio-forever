import type {
  GuiAssignStatement,
  GuiBlock,
  GuiBlockItem,
  GuiDocument,
  GuiIdentifier,
  GuiNamedBlockStatement,
  GuiNumber,
  GuiStatement,
  GuiString,
  GuiTypeDefStatement,
  GuiValue,
  GuiFunctionCall,
  GuiBoolean,
} from './guiDslAst';
import { tokenizeGui, type GuiToken } from './guiDslTokenizer';

export class GuiParseError extends Error {
  pos: number;
  constructor(message: string, pos: number) {
    super(message);
    this.pos = pos;
  }
}

class TokenStream {
  private tokens: GuiToken[];
  private index = 0;

  constructor(tokens: GuiToken[]) {
    this.tokens = tokens;
  }

  peek(offset = 0): GuiToken {
    return this.tokens[Math.min(this.tokens.length - 1, this.index + offset)];
  }

  next(): GuiToken {
    const t = this.peek();
    this.index = Math.min(this.tokens.length - 1, this.index + 1);
    return t;
  }

  expect(kind: GuiToken['kind']): GuiToken {
    const t = this.peek();
    if (t.kind !== kind) throw new GuiParseError(`expected token '${kind}', got '${t.kind}'`, t.pos);
    return this.next();
  }
}

const tokenToName = (t: GuiToken): string => {
  if (t.kind === 'ident' || t.kind === 'string' || t.kind === 'number' || t.kind === 'boolean') return t.value ?? '';
  return t.kind;
};

const KNOWN_ELEMENT_KEYWORDS = new Set([
  'panel', 'badge', 'header', 'footer', 'title', 'value', 'label', 'icon',
  'list', 'item', 'text', 'button', 'window', 'widget', 'container',
  'hbox', 'vbox', 'div', 'span', 'img', 'textbox', 'progressbar',
  'divider', 'spacer', 'grid', 'scrollbox', 'anchor',
  'input', 'select', 'textarea', 'checkbox', 'radio', 'form',
  'table', 'tr', 'td', 'th', 'card', 'modal', 'tooltip', 'tabs', 'tab',
]);

const isElementKeyword = (kw: string): boolean => {
  if (KNOWN_ELEMENT_KEYWORDS.has(kw.toLowerCase())) return true;
  if (kw.length > 0 && kw[0] >= 'A' && kw[0] <= 'Z') return true;
  return false;
};

export function parseGuiDocument(src: string): GuiDocument {
  if (src.trimStart().startsWith('<!DOCTYPE')) {
    throw new GuiParseError('Received HTML content instead of GUI DSL.', 0);
  }
  const tokens = tokenizeGui(src);
  const ts = new TokenStream(tokens);
  const items: GuiStatement[] = [];
  while (ts.peek().kind !== 'eof') {
    items.push(parseStatement(ts, true));
  }
  return { kind: 'document', items };
}

function parseStatement(ts: TokenStream, topLevel: boolean): GuiStatement {
  const t = ts.peek();
  if (t.kind !== 'ident') throw new GuiParseError(`expected identifier, got '${tokenToName(t)}'`, t.pos);

  const kw = String(t.value ?? '');
  const kwLower = kw.toLowerCase();
  const next = ts.peek(1);

  if (next.kind === '=' || next.kind === ':') return parseAssign(ts);

  if (kwLower === 'template' || kwLower === 'types' || kwLower === 'block' || kwLower === 'blockoverride') {
    return parseNamedBlock(ts);
  }

  if (kwLower === 'type') {
    if (topLevel) throw new GuiParseError(`'type' is only valid inside 'types' blocks`, t.pos);
    return parseTypeDef(ts);
  }

  if (next.kind === 'ident' || next.kind === 'string') return parseNamedBlock(ts);

  if (next.kind === '{') {
    const keyword = String(ts.expect('ident').value ?? '');
    const body = parseBlock(ts);
    return { kind: 'named_block', keyword, name: '', body };
  }

  throw new GuiParseError(`unexpected token '${tokenToName(next)}' after '${kw}'`, next.pos);
}

function parseNamedBlock(ts: TokenStream): GuiNamedBlockStatement {
  const keywordTok = ts.expect('ident');
  const keyword = String(keywordTok.value ?? '');
  const nameTok = ts.peek();
  if (nameTok.kind !== 'ident' && nameTok.kind !== 'string') {
    throw new GuiParseError(`expected name after '${keyword}', got '${tokenToName(nameTok)}'`, nameTok.pos);
  }
  ts.next();
  const name = String(nameTok.value ?? '');
  const body = parseBlock(ts);
  return { kind: 'named_block', keyword, name, body };
}

function parseTypeDef(ts: TokenStream): GuiTypeDefStatement {
  ts.expect('ident');
  const nameTok = ts.peek();
  if (nameTok.kind !== 'ident' && nameTok.kind !== 'string') {
    throw new GuiParseError(`expected type name, got '${tokenToName(nameTok)}'`, nameTok.pos);
  }
  ts.next();
  const name = String(nameTok.value ?? '');
  ts.expect('=');
  const baseTok = ts.peek();
  if (baseTok.kind !== 'ident') throw new GuiParseError(`expected base element name after '='`, baseTok.pos);
  ts.next();
  const base = String(baseTok.value ?? '');
  const body = parseBlock(ts);
  return { kind: 'typedef', name, base, body };
}

function parseAssign(ts: TokenStream): GuiAssignStatement {
  const keyTok = ts.expect('ident');
  const key = String(keyTok.value ?? '');
  if (ts.peek().kind === '=' || ts.peek().kind === ':') {
    ts.next();
  } else {
    throw new GuiParseError(`expected '=' or ':'`, ts.peek().pos);
  }
  const value = parseValue(ts);
  return { kind: 'assign', key, value };
}

function parseValue(ts: TokenStream): GuiValue {
  const t = ts.peek();
  if (t.kind === '{') return parseBlock(ts);
  if (t.kind === 'string') {
    ts.next();
    return { kind: 'string', value: String(t.value ?? '') } as GuiString;
  }
  if (t.kind === 'number') {
    ts.next();
    const n = Number(t.value);
    return { kind: 'number', value: Number.isFinite(n) ? n : 0 } as GuiNumber;
  }
  if (t.kind === 'boolean') {
    ts.next();
    return { kind: 'boolean', value: String(t.value ?? '').toLowerCase() === 'yes' } as GuiBoolean;
  }
  if (t.kind === 'ident') {
    ts.next();
    const name = String(t.value ?? '');
    if (ts.peek().kind === '(') {
      ts.expect('(');
      const args: GuiValue[] = [];
      while (ts.peek().kind !== ')' && ts.peek().kind !== 'eof') {
        args.push(parseValue(ts));
      }
      ts.expect(')');
      return { kind: 'function', name, args } as GuiFunctionCall;
    }
    return { kind: 'identifier', value: name } as GuiIdentifier;
  }
  throw new GuiParseError(`unexpected token '${tokenToName(t)}'`, t.pos);
}

function parseBlock(ts: TokenStream): GuiBlock {
  ts.expect('{');
  const items: GuiBlockItem[] = [];
  while (ts.peek().kind !== '}' && ts.peek().kind !== 'eof') {
    const t = ts.peek();
    if (t.kind === 'ident') {
      const kw = String(t.value ?? '').toLowerCase();
      if (kw === 'block' || kw === 'blockoverride') {
        items.push(parseNamedBlock(ts));
        continue;
      }
      const next = ts.peek(1);
      if (next.kind === '=' || next.kind === ':') {
        items.push(parseAssign(ts));
        continue;
      }
      if (kw === 'type') {
        items.push(parseTypeDef(ts));
        continue;
      }
      if (next.kind === 'ident' || next.kind === 'string') {
        if (isElementKeyword(kw)) {
          items.push(parseNamedBlock(ts));
          continue;
        }
      }
      if (next.kind === '{') {
        const keyword = String(ts.expect('ident').value ?? '');
        const body = parseBlock(ts);
        items.push({ kind: 'named_block', keyword, name: '', body } as GuiNamedBlockStatement);
        continue;
      }
    }
    items.push(parseValue(ts));
  }
  ts.expect('}');
  return { kind: 'block', items };
}
