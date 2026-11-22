import Ajv from 'ajv';

/** Validate canonical host schemas without changing approval-bound arguments. */
export function toolArgumentValidationError(schema: unknown, args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'Arguments must be a JSON object.';
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return 'The canonical tool argument schema is unavailable or invalid.';
  const ajv = new Ajv({ strict: false, allowUnionTypes: true, ownProperties: true,
    coerceTypes: false, useDefaults: false, removeAdditional: false, addUsedSchema: false });
  try {
    // Synchronous compilation never fetches remote $refs; unresolved references fail closed.
    const validate = ajv.compile(schema);
    if ('$async' in validate && validate.$async) return 'The canonical tool argument schema must support synchronous validation.';
    if (validate(args)) return;
    const error = validate.errors?.[0];
    return `Arguments${error?.instancePath ?? ''} ${error?.message ?? 'do not match the canonical schema'}.`;
  } catch {
    return 'The canonical tool argument schema could not be compiled. Check the tool definition.';
  }
}
