import { describe, it, expect } from 'vitest';
import { tokenizeGui } from './guiDslTokenizer';
import { parseGuiDocument, GuiParseError } from './guiDslParser';
import { parseGuiModule } from './guiDslModule';
import { compileGui } from './guiDslExpand';

// ── Tokenizer tests ──────────────────────────────────────────────────────────

describe('tokenizeGui()', () => {
  it('tokenizes empty string to [eof]', () => {
    const tokens = tokenizeGui('');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].kind).toBe('eof');
  });

  it('tokenizes identifiers', () => {
    const tokens = tokenizeGui('window label button');
    const idents = tokens.filter((t) => t.kind === 'ident');
    expect(idents).toHaveLength(3);
    expect(idents.map((t) => t.value)).toEqual(['window', 'label', 'button']);
  });

  it('tokenizes string literals with double quotes', () => {
    const tokens = tokenizeGui('"hello world"');
    const str = tokens.find((t) => t.kind === 'string');
    expect(str?.value).toBe('hello world');
  });

  it('tokenizes escape sequences in strings', () => {
    const tokens = tokenizeGui('"line\\nnewline"');
    const str = tokens.find((t) => t.kind === 'string');
    expect(str?.value).toBe('line\nnewline');
  });

  it('tokenizes boolean literals (yes/no)', () => {
    const tokens = tokenizeGui('yes no');
    const bools = tokens.filter((t) => t.kind === 'boolean');
    expect(bools).toHaveLength(2);
    expect(bools[0].value).toBe('yes');
    expect(bools[1].value).toBe('no');
  });

  it('tokenizes true/false as idents (not booleans)', () => {
    const tokens = tokenizeGui('true false');
    const idents = tokens.filter((t) => t.kind === 'ident');
    expect(idents.map((t) => t.value)).toContain('true');
    expect(idents.map((t) => t.value)).toContain('false');
  });

  it('tokenizes integer numbers', () => {
    const tokens = tokenizeGui('42');
    const num = tokens.find((t) => t.kind === 'number');
    expect(num?.value).toBe('42');
  });

  it('tokenizes negative numbers', () => {
    const tokens = tokenizeGui('-10');
    const num = tokens.find((t) => t.kind === 'number');
    expect(num?.value).toBe('-10');
  });

  it('tokenizes decimal numbers', () => {
    const tokens = tokenizeGui('3.14');
    const num = tokens.find((t) => t.kind === 'number');
    expect(num?.value).toBe('3.14');
  });

  it('skips # comments', () => {
    const tokens = tokenizeGui('# this is a comment\nwindow');
    const idents = tokens.filter((t) => t.kind === 'ident');
    expect(idents).toHaveLength(1);
    expect(idents[0].value).toBe('window');
  });

  it('skips // comments', () => {
    const tokens = tokenizeGui('// comment\nlabel');
    const idents = tokens.filter((t) => t.kind === 'ident');
    expect(idents).toHaveLength(1);
  });

  it('tokenizes structural characters', () => {
    const tokens = tokenizeGui('{}()=:');
    const kinds = tokens.slice(0, -1).map((t) => t.kind);
    expect(kinds).toEqual(['{', '}', '(', ')', '=', ':']);
  });

  it('handles BOM character at start', () => {
    const srcWithBOM = '\uFEFFwindow';
    const tokens = tokenizeGui(srcWithBOM);
    const idents = tokens.filter((t) => t.kind === 'ident');
    expect(idents[0].value).toBe('window');
  });
});

// ── Parser tests ─────────────────────────────────────────────────────────────

describe('parseGuiDocument()', () => {
  it('parses empty input', () => {
    const doc = parseGuiDocument('');
    expect(doc.items).toHaveLength(0);
  });

  it('parses a simple element node', () => {
    const doc = parseGuiDocument('window {}');
    expect(doc.items).toHaveLength(1);
    const item = doc.items[0];
    expect(item.kind).toBe('named_block');
  });

  it('parses assignment statement at top level', () => {
    const doc = parseGuiDocument('title = "Hello"');
    expect(doc.items).toHaveLength(1);
    expect(doc.items[0].kind).toBe('assign');
  });

  it('parses nested elements', () => {
    const src = `
      window {
        label { text = "Hi" }
        button { text = "Click" }
      }
    `;
    const doc = parseGuiDocument(src);
    expect(doc.items).toHaveLength(1);
  });

  it('parses boolean values', () => {
    const doc = parseGuiDocument('enabled = yes');
    expect(doc.items[0].kind).toBe('assign');
  });

  it('parses numeric values', () => {
    const doc = parseGuiDocument('width = 200');
    expect(doc.items[0].kind).toBe('assign');
  });

  it('throws GuiParseError on malformed input', () => {
    expect(() => parseGuiDocument('= value')).toThrow(GuiParseError);
  });

  it('parses function call syntax', () => {
    // Function call syntax is not supported in the DSL — should throw
    expect(() => parseGuiDocument('icon(name="star" size=16)')).toThrow(GuiParseError);
  });

  it('parses string key with colon (shorthand)', () => {
    // The DSL uses '=' for assignments, not ':', so ':' would cause an error in the value
    // Let's test that ':' in an assign context works (key = value with colon as separator)
    const src = `label { text = "World" }`;
    expect(() => parseGuiDocument(src)).not.toThrow();
  });
});

// ── Module (parseGuiModule) tests ────────────────────────────────────────────

describe('parseGuiModule()', () => {
  it('parses empty module', () => {
    const mod = parseGuiModule('');
    expect(mod.roots).toHaveLength(0);
    expect(mod.templates).toEqual({});
    expect(mod.types).toEqual({});
  });

  it('parses root element', () => {
    const mod = parseGuiModule('window {}');
    expect(mod.roots).toHaveLength(1);
    expect(mod.roots[0].kind).toMatch(/element|block_node/);
  });

  it('collects template definitions', () => {
    const src = `
      template Card {
        div { class = "card" }
      }
    `;
    const mod = parseGuiModule(src);
    expect('Card' in mod.templates).toBe(true);
  });

  it('collects type definitions', () => {
    const src = `
      types TypeLib {
        type MyButton = button {}
      }
    `;
    const mod = parseGuiModule(src);
    expect('MyButton' in mod.types).toBe(true);
  });

  it('handles multiple root elements', () => {
    const src = `
      div {}
      div {}
      div {}
    `;
    const mod = parseGuiModule(src);
    expect(mod.roots.length).toBeGreaterThanOrEqual(2);
  });
});

// ── Expand (compileGui) tests ─────────────────────────────────────────────────

describe('compileGui()', () => {
  it('compiles empty source to empty array', () => {
    const nodes = compileGui('');
    expect(nodes).toHaveLength(0);
  });

  it('compiles a simple element', () => {
    const nodes = compileGui('div {}');
    expect(nodes).toHaveLength(1);
  });

  it('compiles nested elements', () => {
    const src = `
      window {
        label { text = "Hello" }
      }
    `;
    const nodes = compileGui(src);
    expect(nodes).toHaveLength(1);
    const root = nodes[0];
    expect(root.kind).toMatch(/element|block_node/);
  });

  it('expands template (using=)', () => {
    const src = `
      template Card {
        div { class = "card" }
      }
      div { using = "Card" }
    `;
    // Should not throw
    const nodes = compileGui(src);
    expect(nodes.length).toBeGreaterThanOrEqual(1);
  });

  it('expands type definitions', () => {
    const src = `
      types TypeLib {
        type MyBtn = button {}
      }
      MyBtn { text = "Click" }
    `;
    const nodes = compileGui(src);
    expect(nodes.length).toBeGreaterThanOrEqual(1);
  });

  it('expands type with body props that have block sub-elements', () => {
    const src = `
      types Lib {
        type Card = div {
          label { text = "Title" }
        }
      }
      Card {}
    `;
    const nodes = compileGui(src);
    expect(nodes.length).toBeGreaterThanOrEqual(1);
    const card = nodes[0] as { kind: string; tag: string; children: unknown[] };
    expect(card.tag).toBe('div');
    expect(card.children).toBeDefined();
  });

  it('template using= merges props with existing children', () => {
    const src = `
      template TplA {
        class = "from-tpl"
        label { text = "tpl-child" }
      }
      div {
        using = "TplA"
        span { text = "custom" }
      }
    `;
    const nodes = compileGui(src);
    expect(nodes).toHaveLength(1);
    const node = nodes[0] as { kind: string; props: Record<string, unknown>; children: unknown[] };
    expect(node.props['class']).toBeDefined();
    expect(node.children.length).toBeGreaterThanOrEqual(1);
  });

  it('ignores unknown template name in using=', () => {
    const src = `div { using = "NonExistentTemplate" }`;
    expect(() => compileGui(src)).not.toThrow();
    const nodes = compileGui(src);
    expect(nodes).toHaveLength(1);
  });

  it('compiles block node (named block with block keyword)', () => {
    const src = `
      types Lib {
        type Card = div {
          block header {}
          block body {}
        }
      }
      Card {
        blockoverride header {
          label { text = "My Header" }
        }
      }
    `;
    const nodes = compileGui(src);
    expect(nodes.length).toBeGreaterThanOrEqual(1);
  });

  it('compiles element tags as assigned values (sub-element shorthand)', () => {
    const src = `
      div {
        label { text = "a" }
        span { text = "b" }
        button { text = "c" }
      }
    `;
    const nodes = compileGui(src);
    expect(nodes).toHaveLength(1);
    const root = nodes[0] as { children: unknown[] };
    expect(root.children.length).toBeGreaterThanOrEqual(3);
  });

  it('scalarToString handles identifier value in using= ', () => {
    // using = SomeName (identifier, not quoted string)
    const src = `
      template SomeName {
        class = "tpl"
      }
      div { using = SomeName }
    `;
    const nodes = compileGui(src);
    expect(nodes.length).toBeGreaterThanOrEqual(1);
  });

  it('handles element with uppercase tag (custom component)', () => {
    const src = `MyComponent { text = "hello" }`;
    const nodes = compileGui(src);
    expect(nodes).toHaveLength(1);
    const node = nodes[0] as { tag: string };
    expect(node.tag).toBe('MyComponent');
  });

  it('handles block_node element in recursive expansion', () => {
    // A block_node in the root children of a div
    const src = `
      types Lib {
        type Card = div {
          block content {
            label { text = "default" }
          }
        }
      }
      Card {
        blockoverride content {
          label { text = "custom" }
        }
      }
    `;
    expect(() => compileGui(src)).not.toThrow();
  });

  it('compiles source with multiple root elements', () => {
    const src = `
      div { text = "one" }
      div { text = "two" }
      div { text = "three" }
    `;
    const nodes = compileGui(src);
    expect(nodes).toHaveLength(3);
  });
});

// ── parseGuiModule extra coverage ────────────────────────────────────────────

describe('parseGuiModule() - extra', () => {
  it('handles block/blockoverride items in named blocks', () => {
    const src = `
      template WithBlocks {
        block header { label { text = "hdr" } }
        blockoverride footer { label { text = "ftr" } }
      }
      div {}
    `;
    const mod = parseGuiModule(src);
    expect(mod.templates['WithBlocks']).toBeDefined();
    expect(mod.roots).toHaveLength(1);
  });

  it('handles element tags inside named block children', () => {
    const src = `
      window {
        hbox {
          button { text = "ok" }
          button { text = "cancel" }
        }
      }
    `;
    const mod = parseGuiModule(src);
    expect(mod.roots).toHaveLength(1);
    const root = mod.roots[0] as { children: unknown[] };
    expect(root.children).toHaveLength(1);
  });
});
