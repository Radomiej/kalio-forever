export interface GuiFunctionCall {
  kind: 'function';
  name: string;
  args: GuiValue[];
}

export type GuiScalar = GuiString | GuiNumber | GuiBoolean | GuiIdentifier | GuiFunctionCall;

export interface GuiString {
  kind: 'string';
  value: string;
}

export interface GuiNumber {
  kind: 'number';
  value: number;
}

export interface GuiBoolean {
  kind: 'boolean';
  value: boolean;
}

export interface GuiIdentifier {
  kind: 'identifier';
  value: string;
}

export type GuiValue = GuiScalar | GuiBlock;

export interface GuiBlock {
  kind: 'block';
  items: GuiBlockItem[];
}

export type GuiBlockItem = GuiStatement | GuiValue;

export type GuiStatement = GuiAssignStatement | GuiNamedBlockStatement | GuiTypeDefStatement;

export interface GuiAssignStatement {
  kind: 'assign';
  key: string;
  value: GuiValue;
}

export interface GuiNamedBlockStatement {
  kind: 'named_block';
  keyword: string;
  name: string | null;
  body: GuiBlock;
}

export interface GuiTypeDefStatement {
  kind: 'typedef';
  name: string;
  base: string;
  body: GuiBlock;
}

export interface GuiDocument {
  kind: 'document';
  items: GuiStatement[];
}

export type GuiNode = GuiElementNode | GuiBlockNode;

export interface GuiElementNode {
  kind: 'element';
  tag: string;
  props: Record<string, GuiValue>;
  children: GuiNode[];
}

export interface GuiBlockNode {
  kind: 'block_node';
  mode: 'block' | 'blockoverride';
  name: string;
  props: Record<string, GuiValue>;
  children: GuiNode[];
}

export interface GuiTemplateDef {
  name: string;
  body: GuiBlock;
}

export interface GuiTypeDef {
  name: string;
  base: string;
  body: GuiBlock;
}

export interface GuiModule {
  doc: GuiDocument;
  templates: Record<string, GuiTemplateDef>;
  types: Record<string, GuiTypeDef>;
  roots: GuiNode[];
}
