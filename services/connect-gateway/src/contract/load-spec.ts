import path from 'node:path';
import { fileURLToPath } from 'node:url';
import SwaggerParser from '@apidevtools/swagger-parser';
import type { OpenAPIV3_1 } from 'openapi-types';

const specEntry = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../openapi/openapi.yaml',
);

let cachedSpec: OpenAPIV3_1.Document | null = null;

export async function loadOpenApiSpec(): Promise<OpenAPIV3_1.Document> {
  if (cachedSpec) {
    return cachedSpec;
  }

  cachedSpec = (await SwaggerParser.dereference(specEntry)) as OpenAPIV3_1.Document;
  return cachedSpec;
}

export type OpenApiRoute = { method: string; path: string };

const HTTP_METHODS = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
  'trace',
]);

export async function listOpenApiRoutes(): Promise<OpenApiRoute[]> {
  const spec = await loadOpenApiSpec();
  const routes: OpenApiRoute[] = [];

  for (const [pathTemplate, pathItem] of Object.entries(spec.paths ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') {
      continue;
    }

    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method) || !operation) {
        continue;
      }

      routes.push({ method: method.toUpperCase(), path: pathTemplate });
    }
  }

  return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}
