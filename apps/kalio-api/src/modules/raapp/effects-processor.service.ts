import vm from 'node:vm';
import { Injectable, Logger } from '@nestjs/common';
import yaml from 'js-yaml';
import { nanoid } from 'nanoid';
import { NativeSystemRegistry } from './native/native-system-registry.service';
import type { NativeSessionContext } from './native/native-system-registry.service';
import { AuditService } from '../chat/audit.service';
import { EntityStore, type Entity } from './entity-store';

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

// ─── ECS effects ─────────────────────────────────────────────────────────────

interface CreateEntityEffect {
  create_entity: {
    id: string;
    components?: Record<string, Record<string, unknown>>;
  };
}

interface DeleteEntityEffect {
  delete_entity: { id: string };
}

interface SetFieldEffect {
  set_field: { entity_id: string; component: string; field: string; value: unknown };
}

type RawEffect =
  | AssignEffect
  | SetEffect
  | IfEffect
  | CallNativeEffect
  | CreateEntityEffect
  | DeleteEntityEffect
  | SetFieldEffect
  | Record<string, unknown>;

interface ParsedSystem {
  id: string;
  condition?: string;
  /** ECS component filter — effects run once per matching entity */
  query?: string[];
  effects?: RawEffect[];
}

// ─── Math helpers exposed inside VM expressions ───────────────────────────────

const VM_MATH = {
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
  sqrt: Math.sqrt,
  pow: Math.pow,
  /** Returns a random float in [min, max) — mirrors ExpressionParser.random() */
  random: (min = 0, max = 1) => Math.random() * (max - min) + min,
  /** Linear interpolation */
  lerp: (a: number, b: number, t: number) => a + (b - a) * t,
};

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
  /** ECS snapshot — populated when systems.yml used create_entity / set_field. */
  entities: Entity[];
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
   * Supports ECS via an optional pre-built EntityStore:
   * - If `entityStore` is provided, systems with a `query: [Component, ...]`
   *   field will execute their effects once per matching entity, injecting
   *   `entity_id` and `entity` into the expression context.
   * - ECS effects (`create_entity`, `delete_entity`, `set_field`) require
   *   an entityStore to be passed; they are silently skipped otherwise.
   *
   * @param systemsContent  Raw systems.yml YAML string
   * @param inputs          Input data for the RA-App
   * @param sessionCtx      Session context (used by native systems)
   * @param entityStore     Optional ECS store — created externally per execution
   * @returns Computed output map, any pending approvals, and entity snapshot
   */
  async processSystemsYaml(
    systemsContent: string,
    inputs: Record<string, unknown>,
    sessionCtx: NativeSessionContext,
    entityStore?: EntityStore,
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

      // Query-based execution — run effects per matching entity
      if (system.query && system.query.length > 0 && entityStore) {
        const entities = entityStore.queryEntities(system.query);
        for (const entity of entities) {
          const entityInput = { ...inputs, entity_id: entity.id, entity: entity.components };
          for (const effect of system.effects ?? []) {
            await this.processEffect(effect, entityInput, output, pendingApprovals, sessionCtx, entityStore);
          }
        }
      } else {
        // Global execution — no entity context
        for (const effect of system.effects ?? []) {
          await this.processEffect(effect, inputs, output, pendingApprovals, sessionCtx, entityStore);
        }
      }
    }

    return { output, pendingApprovals, entities: entityStore?.getAllEntities() ?? [] };
  }

  private async processEffect(
    effect: RawEffect,
    input: Record<string, unknown>,
    output: Record<string, unknown>,
    pendingApprovals: PendingApproval[],
    sessionCtx: NativeSessionContext,
    entityStore?: EntityStore,
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
        await this.processEffect(e, input, output, pendingApprovals, sessionCtx, entityStore);
      }
      return;
    }

    // call_native: { system, args?, output? }
    if ('call_native' in effect) {
      await this.processCallNative(effect as CallNativeEffect, input, output, pendingApprovals, sessionCtx);
      return;
    }

    // ─── ECS effects (require entityStore) ────────────────────────────────

    // create_entity: { id, components? }
    if ('create_entity' in effect) {
      if (!entityStore) {
        this.logger.warn('create_entity effect skipped — no EntityStore available');
        return;
      }
      const { id, components = {} } = (effect as CreateEntityEffect).create_entity;
      entityStore.createEntity(id);
      for (const [component, fields] of Object.entries(components)) {
        // Always initialize the component namespace (even when fields is empty {})
        // so queryEntities() can find entities by component name.
        const entity = entityStore.getEntity(id);
        if (entity && !entity.components[component]) {
          entity.components[component] = {};
        }
        for (const [field, rawValue] of Object.entries(fields as Record<string, unknown>)) {
          const value = typeof rawValue === 'string'
            ? this.evalExpression(rawValue, input, output)
            : rawValue;
          entityStore.setComponentField(id, component, field, value);
        }
      }
      return;
    }

    // delete_entity: { id }
    if ('delete_entity' in effect) {
      if (!entityStore) {
        this.logger.warn('delete_entity effect skipped — no EntityStore available');
        return;
      }
      entityStore.deleteEntity((effect as DeleteEntityEffect).delete_entity.id);
      return;
    }

    // set_field: { entity_id, component, field, value }
    if ('set_field' in effect) {
      if (!entityStore) {
        this.logger.warn('set_field effect skipped — no EntityStore available');
        return;
      }
      const { entity_id: rawEntityId, component, field, value: rawValue } = (effect as SetFieldEffect).set_field;
      // entity_id may reference a query-loop variable (string expression)
      const entity_id = typeof rawEntityId === 'string'
        ? String(this.evalExpression(rawEntityId, input, output) ?? rawEntityId)
        : String(rawEntityId);
      const value = typeof rawValue === 'string'
        ? this.evalExpression(rawValue, input, output)
        : rawValue;
      try {
        entityStore.setComponentField(entity_id, component, field, value);
      } catch (err) {
        this.logger.warn(`set_field: ${err instanceof Error ? err.message : String(err)}`);
      }
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
   *
   * Context exposes:
   * - `input`, `output` — standard pipeline data
   * - `entity_id`, `entity` — present when evaluating inside a query loop
   * - Math helpers: `floor`, `ceil`, `round`, `abs`, `min`, `max`, `sqrt`,
   *   `pow`, `random(min?, max?)`, `lerp(a, b, t)`, `Math`
   *
   * Returns `undefined` on error rather than throwing to keep pipelines running.
   */
  private evalExpression(
    expression: string,
    input: Record<string, unknown>,
    output: Record<string, unknown>,
  ): unknown {
    try {
      const ctx = vm.createContext({
        input,
        output,
        // entity context (present when called inside a query-based system)
        entity_id: (input as Record<string, unknown>)['entity_id'],
        entity: (input as Record<string, unknown>)['entity'],
        // math helpers
        ...VM_MATH,
        Math: VM_MATH,
        __result: undefined,
      });
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
