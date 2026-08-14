export interface StructuredOutputSchemaIssue {
  path: string;
  message: string;
}

type JsonSchemaRecord = Record<string, unknown>;

export function validateStructuredOutputSchema(
  value: unknown,
  schema: JsonSchemaRecord,
  maxIssues: number,
): StructuredOutputSchemaIssue[] {
  const issues: StructuredOutputSchemaIssue[] = [];
  validateValue(value, schema, '/', issues, maxIssues);
  return issues;
}

function validateValue(
  value: unknown,
  schema: JsonSchemaRecord,
  path: string,
  issues: StructuredOutputSchemaIssue[],
  maxIssues: number,
): void {
  if (issues.length >= maxIssues) {
    return;
  }

  const expectedTypes = schemaTypes(schema.type);
  if (expectedTypes.length > 0 && !expectedTypes.some((type) => valueMatchesType(value, type))) {
    addIssue(issues, maxIssues, path, `expected ${expectedTypes.join('|')}`);
    return;
  }

  if (Object.hasOwn(schema, 'const') && !jsonValueEquals(value, schema.const)) {
    addIssue(issues, maxIssues, path, `expected const ${formatValue(schema.const)}`);
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => jsonValueEquals(value, candidate))) {
    addIssue(issues, maxIssues, path, `expected one of ${schema.enum.map(formatValue).join(', ')}`);
  }

  if (issues.length >= maxIssues) {
    return;
  }

  const effectiveType = expectedTypes.find((type) => valueMatchesType(value, type));
  if (effectiveType === 'object' || (expectedTypes.length === 0 && shouldValidateObject(schema, value))) {
    validateObject(value, schema, path, issues, maxIssues);
  }
  if (effectiveType === 'array' || (expectedTypes.length === 0 && Array.isArray(value) && isRecord(schema.items))) {
    validateArray(value, schema, path, issues, maxIssues);
  }
  if (effectiveType === 'number' || effectiveType === 'integer') {
    validateNumber(value, schema, path, issues, maxIssues);
  }
}

function validateObject(
  value: unknown,
  schema: JsonSchemaRecord,
  path: string,
  issues: StructuredOutputSchemaIssue[],
  maxIssues: number,
): void {
  if (!isRecord(value)) {
    addIssue(issues, maxIssues, path, 'expected object');
    return;
  }

  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((key): key is string => typeof key === 'string')
    : [];

  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      addIssue(issues, maxIssues, childPath(path, key), 'is required');
    }
  }

  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(properties, key)) {
        addIssue(issues, maxIssues, childPath(path, key), 'unexpected property');
      }
    }
  }

  for (const [key, propertySchema] of Object.entries(properties)) {
    if (!Object.hasOwn(value, key) || !isRecord(propertySchema)) {
      continue;
    }
    validateValue(value[key], propertySchema, childPath(path, key), issues, maxIssues);
  }
}

function validateArray(
  value: unknown,
  schema: JsonSchemaRecord,
  path: string,
  issues: StructuredOutputSchemaIssue[],
  maxIssues: number,
): void {
  if (!Array.isArray(value)) {
    addIssue(issues, maxIssues, path, 'expected array');
    return;
  }
  if (!isRecord(schema.items)) {
    return;
  }
  value.forEach((item, index) => {
    validateValue(item, schema.items as JsonSchemaRecord, childPath(path, String(index)), issues, maxIssues);
  });
}

function validateNumber(
  value: unknown,
  schema: JsonSchemaRecord,
  path: string,
  issues: StructuredOutputSchemaIssue[],
  maxIssues: number,
): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return;
  }
  if (typeof schema.minimum === 'number' && value < schema.minimum) {
    addIssue(issues, maxIssues, path, `must be >= ${schema.minimum}`);
  }
  if (typeof schema.maximum === 'number' && value > schema.maximum) {
    addIssue(issues, maxIssues, path, `must be <= ${schema.maximum}`);
  }
}

function addIssue(
  issues: StructuredOutputSchemaIssue[],
  maxIssues: number,
  path: string,
  message: string,
): void {
  if (issues.length < maxIssues) {
    issues.push({ path, message });
  }
}

function shouldValidateObject(schema: JsonSchemaRecord, value: unknown): boolean {
  return isRecord(value)
    && (isRecord(schema.properties) || Array.isArray(schema.required) || schema.additionalProperties === false);
}

function schemaTypes(type: unknown): string[] {
  if (typeof type === 'string') {
    return [type];
  }
  if (!Array.isArray(type)) {
    return [];
  }
  return type.filter((entry): entry is string => typeof entry === 'string');
}

function valueMatchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'array':
      return Array.isArray(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'null':
      return value === null;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'object':
      return isRecord(value);
    case 'string':
      return typeof value === 'string';
    default:
      return true;
  }
}

function childPath(path: string, key: string): string {
  const escapedKey = key.replace(/~/g, '~0').replace(/\//g, '~1');
  return path === '/' ? `/${escapedKey}` : `${path}/${escapedKey}`;
}

function jsonValueEquals(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function formatValue(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
