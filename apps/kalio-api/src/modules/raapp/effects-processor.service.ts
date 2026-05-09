import vm from 'node:vm';
import { Injectable, Logger } from '@nestjs/common';
import yaml from 'js-yaml';
import { nanoid } from 'nanoid';
import { NativeSystemRegistry } from './native/native-system-registry.service';
import type { NativeSessionContext } from './native/native-system-registry.service';
import { AuditService } from '../chat/audit.service';

// ─── DSL types (systems.yml) ─────────────────────────────────────────────────

interface AssignEffect {
  assign: { target: string; expression: string };
}

interface SetEffect {
  type: 'set';
  target: string;
  value: unknown;
}

interface IfEffect {
  if: {
    condition: string;
    then: RawEffect[];
    else?: RawEffect[];
  };
}

interface CallNativeEffect {
  call_native: {
    system: string;
    args?: Record<string, string | unknown>;
    output?: string;  // dot-path where result is stored, e.g. "output.fetchedContent"
  };
}

type RawEffect = AssignEffect | SetEffect | IfEffect | CallNativeEffect | Record<string, unknown>;

interface ParsedSystem {
  id: string;
  condition?: string;
  effects?: RawEffect[];
}

// ─── Pending approval record ─────────────────────────────────────────────────

export interface PendingApproval {
  /** Unique ID for this specific approval request */
  id: string;
  system: string;
  /** Resolved args ready to pass to executeApproved() */
  args: Record<string, unknown>;
  /** dot-path in output where the result should be stored, if any */
  outputPath?: string;
  /** Human-readable label for the frontend */
  displayLabel: string;
}

// ─── Execution result ─────────────────────────────────────────────────────────

export interface EffectsProcessorResult {
  output: Record<string, unknown>;
  pendingApprovals: PendingApproval[];
}

// ─── Service ─────────────────────────────────────────────────────────────────

/**
 * Processes `systems.yml` effect pipelines for RA-Apps.
 *
 * Supported effects:
 * - `assign` — evaluates a JS expression via vm sandbox, writes to output
 * - `{ type: 'set', target, value }` — sets a literal value
 * - `if` — evaluates a condition expression; runs then/else branches
 * - `call_native` — dispatches to NativeSystemRegistry; accumulates pending
 *   approvals for systems with `approval_required: true`
 */
@Injectable()
export class EffectsProcessorService {
  private readonly logger = new Logger(EffectsProcessorService.name);

  constructor(
    private readonly nativeRegistry: NativeSystemRegistry,
    private readonly audit: AuditService,
  ) {}

  /**
   * Parse systems.yml YAML and run all effect pipelines.
   *
   * @param systemsContent  Raw systems.yml YAML string
   * @param inputs          Input data for the RA-App
   * @param sessionCtx      Session context (used by native systems)
   * @returns Computed output map and any pending approval requests
   */
  async processSystemsYaml(
    systemsContent: string,
    inputs: Record<string, unknown>,
    sessionCtx: NativeSessionContext,
  ): Promise<EffectsProcessorResult> {
    const parsed = yaml.load(systemsContent) as { systems?: ParsedSystem[] } | null;
    const systems = parsed?.systems ?? [];

    const output: Record<string, unknown> = {};
    const pendingApprovals: PendingApproval[] = [];

    for (const system of systems) {
      // Evaluate optional system condition
      if (system.condition) {
        const condResult = this.evalExpression(system.condition, inputs, output);
        if (!condResult) continue;
      }

      for (const effect of system.effects ?? []) {
        await this.processEffect(effect, inputs, output, pendingApprovals, sessionCtx);
      }
    }

    return { output, pendingApprovals };
  }

  private async processEffect(
    effect: RawEffect,
    input: Record<string, unknown>,
    output: Record<string, unknown>,
    pendingApprovals: PendingApproval[],
    sessionCtx: NativeSessionContext,
  ): Promise<void> {
    // assign: { target, expression }
    if ('assign' in effect) {
      const { target, expression } = (effect as AssignEffect).assign;
      const value = this.evalExpression(expression, input, output);
      this.setPath(output, target.replace(/^output\./, ''), value);
      return;
    }

    // { type: 'set', target, value }
    if ('type' in effect && (effect as SetEffect).type === 'set') {
      const { target, value } = effect as SetEffect;
      this.setPath(output, target.replace(/^output\./, ''), value);
      return;
    }

    // if: { condition, then, else? }
    if ('if' in effect) {
      const { condition, then: thenBranch, else: elseBranch } = (effect as IfEffect).if;
      const condResult = this.evalExpression(condition, input, output);
      const branch = condResult ? thenBranch : (elseBranch ?? []);
      for (const e of branch) {
        await this.processEffect(e, input, output, pendingApprovals, sessionCtx);
      }
      return;
    }

    // call_native: { system, args?, output? }
    if ('call_native' in effect) {
      await this.processCallNative(effect as CallNativeEffect, input, output, pendingApprovals, sessionCtx);
      return;
    }

    this.logger.debug(`Unknown effect type: ${JSON.stringify(effect)}`);
  }

  private async processCallNative(
    effect: CallNativeEffect,
    input: Record<string, unknown>,
    output: Record<string, unknown>,
    pendingApprovals: PendingApproval[],
    sessionCtx: NativeSessionContext,
  ): Promise<void> {
    const { system, args: rawArgs = {}, output: outputPath } = effect.call_native;

    // Resolve arg expressions
    const resolvedArgs: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rawArgs)) {
      resolvedArgs[k] =
        typeof v === 'string' ? this.evalExpression(v, input, output) : v;
    }

    let executeResult: { result: unknown; approval_required: boolean };
    try {
      executeResult = await this.nativeRegistry.execute(system, resolvedArgs, sessionCtx);
    } catch (err) {
      this.logger.error(`call_native "${system}" failed: ${err instanceof Error ? err.message : String(err)}`, err);
      void this.audit.log({
        sessionId: sessionCtx.sessionId,
        type: 'raapp_native_call',
        label: `raapp:call_native ${system} ERROR`,
        data: { system, args: resolvedArgs, error: err instanceof Error ? err.message : String(err) },
      });
      if (outputPath) {
        this.setPath(output, outputPath.replace(/^output\./, ''), {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    void this.audit.log({
      sessionId: sessionCtx.sessionId,
      type: 'raapp_native_call',
      label: `raapp:call_native ${system}`,
      data: {
        system,
        args: resolvedArgs,
        approval_required: executeResult.approval_required,
      },
    });

    if (executeResult.approval_required) {
      const nativeSystem = this.nativeRegistry.get(system);
      pendingApprovals.push({
        id: nanoid(),
        system,
        args: resolvedArgs,
        outputPath,
        displayLabel: nativeSystem?.description ?? system,
      });
      return;
    }

    if (outputPath) {
      this.setPath(output, outputPath.replace(/^output\./, ''), executeResult.result);
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Evaluate a JS expression in an isolated VM sandbox.
   * Context exposes `input` and `output`.
   * Returns `undefined` on error rather than throwing to keep pipelines running.
   */
  private evalExpression(
    expression: string,
    input: Record<string, unknown>,
    output: Record<string, unknown>,
  ): unknown {
    try {
      const ctx = vm.createContext({ input, output, __result: undefined });
      vm.runInContext(`__result = (${expression})`, ctx, { timeout: 1000 });
      return ctx['__result'];
    } catch (err) {
      this.logger.warn(
        `Expression eval failed: "${expression}" — ${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }
  }

  /**
   * Set a value at a dot-path in an object, creating intermediate keys.
   * E.g. `setPath(obj, 'a.b.c', 1)` → `obj.a.b.c = 1`
   */
  private setPath(
    obj: Record<string, unknown>,
    dotPath: string,
    value: unknown,
  ): void {
    const parts = dotPath.split('.');
    let current: Record<string, unknown> = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (typeof current[part] !== 'object' || current[part] === null) {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]] = value;
  }
}
