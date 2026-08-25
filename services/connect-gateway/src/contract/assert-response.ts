import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import type { OpenAPIV3_1 } from 'openapi-types';
import { expect } from 'vitest';
import { loadOpenApiSpec } from './load-spec.js';

const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: true });
addFormats(ajv);

const compiledValidators = new Map<string, ValidateFunction>();

function validatorCacheKey(path: string, method: string, status: number): string {
  return `${method.toUpperCase()} ${path} ${status}`;
}

function getResponseDefinition(
  spec: OpenAPIV3_1.Document,
  path: string,
  method: string,
  status: number,
): OpenAPIV3_1.ResponseObject | undefined {
  const pathItem = spec.paths?.[path];
  if (!pathItem) {
    return undefined;
  }

  const operation = pathItem[method.toLowerCase() as keyof OpenAPIV3_1.PathItemObject];
  if (!operation || typeof operation !== 'object' || !('responses' in operation)) {
    return undefined;
  }

  const responses = operation.responses;
  const response = responses?.[String(status)] ?? responses?.default;
  if (!response || typeof response !== 'object') {
    return undefined;
  }

  if ('$ref' in response) {
    return undefined;
  }

  return response as OpenAPIV3_1.ResponseObject;
}

function getJsonResponseSchema(
  spec: OpenAPIV3_1.Document,
  path: string,
  method: string,
  status: number,
): OpenAPIV3_1.SchemaObject | undefined {
  const response = getResponseDefinition(spec, path, method, status);
  const schema = response?.content?.['application/json']?.schema;

  if (!schema || typeof schema !== 'object' || '$ref' in schema) {
    return undefined;
  }

  return schema as OpenAPIV3_1.SchemaObject;
}

async function getValidator(
  path: string,
  method: string,
  status: number,
): Promise<ValidateFunction | null> {
  const cacheKey = validatorCacheKey(path, method, status);
  const cached = compiledValidators.get(cacheKey);
  if (cached) {
    return cached;
  }

  const spec = await loadOpenApiSpec();
  const schema = getJsonResponseSchema(spec, path, method, status);
  if (!schema) {
    return null;
  }

  const validate = ajv.compile(schema);
  compiledValidators.set(cacheKey, validate);
  return validate;
}

export type ValidationResult = {
  valid: boolean;
  errors?: ErrorObject[] | null;
};

export function validateAgainstSchema(schema: unknown, body: unknown): ValidationResult {
  const validate = ajv.compile(schema as OpenAPIV3_1.SchemaObject);
  const valid = validate(body);

  return {
    valid: Boolean(valid),
    errors: validate.errors,
  };
}

export async function assertResponseMatchesSpec(options: {
  method: string;
  path: string;
  status: number;
  body?: unknown;
  contentType?: string | null;
  skipBody?: boolean;
}): Promise<void> {
  const spec = await loadOpenApiSpec();
  const response = getResponseDefinition(spec, options.path, options.method, options.status);

  if (!response) {
    throw new Error(
      `No OpenAPI response documented for ${options.method.toUpperCase()} ${options.path} -> ${options.status}`,
    );
  }

  const sseSchema = response.content?.['text/event-stream'];
  if (sseSchema) {
    if (options.status >= 200 && options.status < 300) {
      expect(options.contentType ?? '').toContain('text/event-stream');
    }
    return;
  }

  if (options.skipBody) {
    return;
  }

  const validate = await getValidator(options.path, options.method, options.status);
  if (!validate) {
    throw new Error(
      `No JSON response schema for ${options.method.toUpperCase()} ${options.path} -> ${options.status}`,
    );
  }

  const valid = validate(options.body);
  if (!valid) {
    throw new Error(
      `Response body does not match OpenAPI schema for ${options.method.toUpperCase()} ${options.path} -> ${options.status}: ${JSON.stringify(validate.errors, null, 2)}`,
    );
  }
}

export async function expectResponseMatchesSpec(
  response: Response,
  options: {
    method: string;
    path: string;
    expectedStatus?: number;
    skipBody?: boolean;
  },
): Promise<unknown> {
  const status = options.expectedStatus ?? response.status;
  expect(response.status).toBe(status);

  const contentType = response.headers.get('Content-Type');

  if (contentType?.includes('text/event-stream')) {
    await assertResponseMatchesSpec({
      method: options.method,
      path: options.path,
      status,
      contentType,
      skipBody: true,
    });
    return undefined;
  }

  const body = status === 204 ? undefined : await response.json();

  await assertResponseMatchesSpec({
    method: options.method,
    path: options.path,
    status,
    body,
    contentType,
    skipBody: options.skipBody,
  });

  return body;
}
