import { describe, expect, it } from 'vitest';
import { GATEWAY_ROUTE_MANIFEST } from '../route-manifest.js';
import { listOpenApiRoutes } from './load-spec.js';

function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

describe('OpenAPI route coverage', () => {
  it('matches the gateway route manifest in both directions', async () => {
    const specRoutes = await listOpenApiRoutes();
    const manifestKeys = new Set(
      GATEWAY_ROUTE_MANIFEST.map((route) => routeKey(route.method, route.path)),
    );
    const specKeys = new Set(specRoutes.map((route) => routeKey(route.method, route.path)));

    const missingFromSpec = [...manifestKeys].filter((key) => !specKeys.has(key));
    const extraInSpec = [...specKeys].filter((key) => !manifestKeys.has(key));

    expect(missingFromSpec, 'manifest routes missing from OpenAPI spec').toEqual([]);
    expect(extraInSpec, 'OpenAPI routes missing from manifest').toEqual([]);
    expect(specRoutes).toHaveLength(GATEWAY_ROUTE_MANIFEST.length);
  });
});
