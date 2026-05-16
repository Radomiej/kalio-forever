import { Injectable, Logger } from '@nestjs/common';
import yaml from 'js-yaml';
import type { ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { RAAppService } from '../../raapp/raapp.service';
import { EffectsProcessorService } from '../../raapp/effects-processor.service';
import { EntityStore } from '../../raapp/entity-store';
import { VFSService } from '../../vfs/vfs.service';

// ─── Types from tests.yml ─────────────────────────────────────────────────────

interface TestCase {
  name: string;
  input: Record<string, unknown>;
  expect: Record<string, unknown>;
  systems?: string[];
}

interface TestSuite {
  tests: TestCase[];
}

interface TestResult {
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function deepEqual(a: unknown, b: unknown): boolean {
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

function isEntityExpectationList(value: unknown): value is EntityExpectation[] {
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

function filterSystemsYaml(systemsContent: string, requestedSystems: string[]): string {
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

function collectEntityExpectationFailures(actualEntities: unknown, expectations: EntityExpectation[]): string[] {
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

// ─── raapp_test ───────────────────────────────────────────────────────────────

@Injectable()
@Tool({
  name: 'raapp_test',
  description:
    'Run the test suite defined in tests.yml of either a stored RA-App release or a raw VFS draft. ' +
    'Each test provides input data and expected output values. ' +
    'Tests exercise the systems.yml effect pipeline (assign, if, ECS effects) — ' +
    'UI rendering is NOT tested here. ' +
    'Returns a summary of passed/failed tests with actual vs expected values.',
  parameters: {
    type: 'object',
    required: [],
    properties: {
      id: {
        type: 'string',
        description: 'The stored RA-App release ID to test.',
      },
      draft_id: {
        type: 'string',
        description: 'The raw session draft ID to test from drafts/<draft_id> in VFS.',
      },
      test_name: {
        type: 'string',
        description: 'Run only this specific test by name. If omitted, all tests are run.',
      },
    },
  },
  requiresConfirmation: false,
})
export class RaAppTestTool {
  private readonly logger = new Logger(RaAppTestTool.name);

  constructor(
    private readonly raapp: RAAppService,
    private readonly effectsProcessor: EffectsProcessorService,
    private readonly vfs: VFSService,
  ) {}

  async execute(request: ToolCallRequest): Promise<object> {
    const id = request.args['id'] as string;
    const draftId = request.args['draft_id'] as string | undefined;
    const filterName = request.args['test_name'] as string | undefined;
    const sessionId = request.sessionId;

    if (!id && !draftId) {
      return {
        status: 'error',
        message: 'Either id or draft_id is required.',
      };
    }

    if (id && draftId) {
      return {
        status: 'error',
        message: 'Provide either id or draft_id, not both.',
      };
    }

    let testsYml: string | null;
    let systemsContent: string | null;

    if (draftId) {
      try {
        testsYml = this.vfs.readFile(sessionId, `drafts/${draftId}/tests.yml`).content;
      } catch {
        return {
          status: 'error',
          message: `Draft "${draftId}" has no tests.yml. Add a test suite to the draft first.`,
        };
      }

      try {
        systemsContent = this.vfs.readFile(sessionId, `drafts/${draftId}/systems.yml`).content;
      } catch {
        return {
          status: 'error',
          message: `Draft "${draftId}" has no systems.yml. Add systems logic to the draft first.`,
        };
      }
    } else {
      const app = this.raapp.getById(id);
      if (!app) {
        return {
          status: 'error',
          message: `RA-App "${id}" not found. Use list_raapps to discover available IDs.`,
        };
      }

      systemsContent = app.systemsContent;
      try {
        const files = await this.raapp.getSourceFiles(id);
        testsYml = files['tests.yml'] ?? null;
      } catch (err) {
        this.logger.error(`[raapp_test] Failed to read source files for ${id}`, err);
        return {
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        };
      }
    }

    if (!testsYml) {
      return {
        status: 'error',
        message: id
          ? `RA-App "${id}" has no tests.yml. Add a test suite to the app first.`
          : `Draft "${draftId}" has no tests.yml. Add a test suite to the draft first.`,
      };
    }

    if (!systemsContent) {
      return {
        status: 'error',
        message: id
          ? `RA-App "${id}" has no systems.yml. Add systems logic to the app first.`
          : `Draft "${draftId}" has no systems.yml. Add systems logic to the draft first.`,
      };
    }

    let suite: TestSuite;
    try {
      suite = yaml.load(testsYml) as TestSuite;
      if (!suite?.tests || !Array.isArray(suite.tests)) {
        return { status: 'error', message: 'tests.yml must have a top-level "tests" array.' };
      }
    } catch (err) {
      return {
        status: 'error',
        message: `Failed to parse tests.yml: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const testCases = filterName
      ? suite.tests.filter((t) => t.name === filterName)
      : suite.tests;

    if (testCases.length === 0) {
      return {
        status: 'error',
        message: filterName
          ? `Test "${filterName}" not found in tests.yml.`
          : 'tests.yml contains no test cases.',
      };
    }

    const results: TestResult[] = [];

    for (const tc of testCases) {
      const result = await this.runTestCase(tc, systemsContent, sessionId);
      results.push(result);
    }

    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;

    return {
      status: failed === 0 ? 'all_passed' : 'some_failed',
      ...(id ? { app_id: id } : {}),
      ...(draftId ? { draft_id: draftId } : {}),
      total: results.length,
      passed,
      failed,
      results,
    };
  }

  private async runTestCase(
    tc: TestCase,
    systemsContent: string | null,
    sessionId: string,
  ): Promise<TestResult> {
    const actual: Record<string, unknown> = {};
    const effectiveSystemsContent =
      systemsContent && tc.systems?.length
        ? filterSystemsYaml(systemsContent, tc.systems)
        : systemsContent;

    if (effectiveSystemsContent) {
      try {
        const entityStore = new EntityStore();
        const effectsResult = await this.effectsProcessor.processSystemsYaml(
          effectiveSystemsContent,
          tc.input,
          { sessionId },
          entityStore,
        );
        Object.assign(actual, effectsResult.output);
        if (effectsResult.entities.length > 0) {
          actual['entities'] = effectsResult.entities;
        }
      } catch (err) {
        return {
          name: tc.name,
          passed: false,
          expected: tc.expect,
          actual,
          failures: [`Execution error: ${err instanceof Error ? err.message : String(err)}`],
        };
      }
    }

    // Compare actual vs expected using structural deep equality
    const failures: string[] = [];
    for (const [key, expectedValue] of Object.entries(tc.expect)) {
      const actualValue = actual[key];
      if (key === 'entities' && isEntityExpectationList(expectedValue)) {
        failures.push(...collectEntityExpectationFailures(actualValue, expectedValue));
        continue;
      }
      const match = deepEqual(actualValue, expectedValue);
      if (!match) {
        failures.push(
          `"${key}": expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`,
        );
      }
    }

    return {
      name: tc.name,
      passed: failures.length === 0,
      expected: tc.expect,
      actual,
      failures,
    };
  }
}
