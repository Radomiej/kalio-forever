import yaml from 'js-yaml';

export interface TestCase {
  name: string;
  input: Record<string, unknown>;
  expect: Record<string, unknown>;
  systems?: string[];
}

export interface TestSuite {
  tests: TestCase[];
}

export interface TestResult {
  name: string;
  passed: boolean;
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
  failures: string[];
}

interface EntityExpectation {
  component: string;
  field: string;
  value: unknown;
  operator?: string;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (typeof a === 'object') {
    const objA = a as Record<string, unknown>;
    const objB = b as Record<string, unknown>;
    const keysA = Object.keys(objA);
    const keysB = Object.keys(objB);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((k) => deepEqual(objA[k], objB[k]));
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isEntityExpectation(value: unknown): value is EntityExpectation {
  return isRecord(value)
    && typeof value['component'] === 'string'
    && typeof value['field'] === 'string'
    && 'value' in value;
}

export function isEntityExpectationList(value: unknown): value is EntityExpectation[] {
  return Array.isArray(value) && value.every(isEntityExpectation);
}

function compareWithOperator(actual: unknown, expected: unknown, operator?: string): boolean {
  if (!operator) {
    return deepEqual(actual, expected);
  }

  switch (operator) {
    case '=':
    case '==':
    case '===':
      return deepEqual(actual, expected);
    case '!=':
    case '!==':
      return !deepEqual(actual, expected);
    case '<':
      return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
    case '<=':
      return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
    case '>':
      return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
    case '>=':
      return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
    default:
      return false;
  }
}

export function filterSystemsYaml(systemsContent: string, requestedSystems: string[]): string {
  if (requestedSystems.length === 0) {
    return systemsContent;
  }

  try {
    const parsed = yaml.load(systemsContent);
    if (!isRecord(parsed)) {
      return systemsContent;
    }

    const systems = parsed['systems'];
    if (!Array.isArray(systems)) {
      return systemsContent;
    }

    const requested = new Set(requestedSystems);
    const filteredSystems = systems.filter((system) => {
      if (!isRecord(system)) {
        return false;
      }

      const id = typeof system['id'] === 'string' ? system['id'] : undefined;
      const name = typeof system['name'] === 'string' ? system['name'] : undefined;
      return (id !== undefined && requested.has(id)) || (name !== undefined && requested.has(name));
    });

    return yaml.dump({
      ...parsed,
      systems: filteredSystems,
    });
  } catch {
    return systemsContent;
  }
}

function formatEntityExpectation(expectation: EntityExpectation): string {
  return `${expectation.component}.${expectation.field} ${expectation.operator ?? '=='} ${JSON.stringify(expectation.value)}`;
}

function matchesEntityExpectation(entity: unknown, expectation: EntityExpectation): boolean {
  if (!isRecord(entity)) {
    return false;
  }

  const components = entity['components'];
  if (!isRecord(components)) {
    return false;
  }

  const component = components[expectation.component];
  if (!isRecord(component)) {
    return false;
  }

  return compareWithOperator(component[expectation.field], expectation.value, expectation.operator);
}

export function collectEntityExpectationFailures(actualEntities: unknown, expectations: EntityExpectation[]): string[] {
  if (!Array.isArray(actualEntities)) {
    return expectations.map((expectation) =>
      `"entities": expected ${formatEntityExpectation(expectation)}, got ${JSON.stringify(actualEntities)}`,
    );
  }

  return expectations.flatMap((expectation) =>
    actualEntities.some((entity) => matchesEntityExpectation(entity, expectation))
      ? []
      : [`"entities": expected ${formatEntityExpectation(expectation)}, got ${JSON.stringify(actualEntities)}`],
  );
}
