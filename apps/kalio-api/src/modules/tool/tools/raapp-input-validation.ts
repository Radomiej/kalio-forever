import Ajv from 'ajv';

const ajv = new Ajv({ strict: false, ownProperties: true, addUsedSchema: false });

export function validateRaAppInputs(schema: unknown, inputs: unknown): string | undefined {
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) {
    return 'Pass inputs as a JSON object.';
  }
  if (schema === undefined || schema === null) return;
  if (typeof schema !== 'object' || Array.isArray(schema)) return 'The app input schema is invalid.';

  try {
    const validate = ajv.compile(schema);
    if (validate(inputs)) return;
    const error = validate.errors?.[0];
    const choices = error?.keyword === 'enum' && Array.isArray(error.params.allowedValues)
      ? `: ${error.params.allowedValues.map(String).join(', ')}`
      : '';
    return `inputs${error?.instancePath ?? ''} ${error?.message ?? 'does not match the app schema'}${choices}. Call list_raapps to inspect input_schema and retry.`;
  } catch {
    return 'The app input schema could not be compiled. Check its definition before retrying.';
  } finally {
    ajv.removeSchema(schema);
  }
}
