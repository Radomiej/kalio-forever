import { Injectable, Logger } from '@nestjs/common';
import yaml from 'js-yaml';
import type { ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { RAAppService } from '../../raapp/raapp.service';
import { EffectsProcessorService } from '../../raapp/effects-processor.service';
import { EntityStore } from '../../raapp/entity-store';
import { VFSService } from '../../vfs/vfs.service';
import {
  type TestCase,
  type TestResult,
  type TestSuite,
  collectEntityExpectationFailures,
  deepEqual,
  filterSystemsYaml,
  isEntityExpectationList,
} from './raapp-test.tools.helpers';

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
