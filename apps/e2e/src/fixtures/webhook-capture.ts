import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test as gatewayTest } from './gateway.js';

export interface WebhookPayload {
  id: string;
  type: string;
  created: number;
  data: Record<string, unknown>;
}

export interface WebhookCapture {
  /** Local URL of the capture server. Register this via POST /admin/webhooks. */
  url: string;
  /** All received webhook payloads in arrival order. */
  received: WebhookPayload[];
  /**
   * Returns a Promise that resolves with the first received webhook of the
   * given type. Rejects after timeoutMs if not received.
   */
  waitForEvent(type: string, timeoutMs?: number): Promise<WebhookPayload>;
}

export const test = gatewayTest.extend<{ webhookCapture: WebhookCapture }>({
  webhookCapture: async ({ gatewayUrl, adminToken, apiKeyId }, use) => {
    const received: WebhookPayload[] = [];
    // type → list of pending resolvers
    const pending = new Map<string, Array<(p: WebhookPayload) => void>>();

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        let payload: WebhookPayload;
        try {
          payload = JSON.parse(body) as WebhookPayload;
        } catch {
          res.writeHead(400).end('bad json');
          return;
        }

        // Respond to endpoint verification challenge from the gateway
        if (payload.type === 'endpoint.verification') {
          const challenge = (payload.data as { challenge?: string }).challenge ?? '';
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ challenge }));
          return;
        }

        received.push(payload);

        const resolvers = pending.get(payload.type);
        if (resolvers && resolvers.length > 0) {
          const resolve = resolvers.shift()!;
          resolve(payload);
        }

        res.writeHead(200).end('ok');
      });
    });

    // Bind to a random available port
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as AddressInfo).port;
    const captureUrl = `http://127.0.0.1:${port}`;

    // Register the capture URL as a webhook endpoint
    let endpointId: string | null = null;
    try {
      const regRes = await fetch(`${gatewayUrl}/admin/webhooks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          url: captureUrl,
          apiKeyId,
          enabledEvents: [
            'escrow.created',
            'trade.completed',
            'dispute.opened',
            'payment.reported',
          ],
        }),
      });

      if (regRes.ok) {
        const regBody = (await regRes.json()) as {
          endpoint: { id: string; secret: string };
        };
        endpointId = regBody.endpoint.id;

        // Trigger verification (gateway will POST endpoint.verification to captureUrl)
        await fetch(`${gatewayUrl}/admin/webhooks/${endpointId}/verify`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminToken}` },
        });
      }
      // If registration fails (e.g. webhooks not supported in test mode), proceed silently.
      // The webhook tests will handle missing delivery gracefully.
    } catch {
      // Swallow registration errors — webhook tests use test.skip if needed
    }

    const capture: WebhookCapture = {
      url: captureUrl,
      received,
      waitForEvent(type: string, timeoutMs = 8_000): Promise<WebhookPayload> {
        // Already received?
        const existing = received.find((p) => p.type === type);
        if (existing) return Promise.resolve(existing);

        return new Promise<WebhookPayload>((resolve, reject) => {
          const timer = setTimeout(() => {
            const resolvers = pending.get(type);
            if (resolvers) {
              const idx = resolvers.indexOf(resolve);
              if (idx !== -1) resolvers.splice(idx, 1);
            }
            reject(new Error(`[e2e] Timeout waiting for webhook event "${type}" after ${timeoutMs}ms`));
          }, timeoutMs);

          const resolvers = pending.get(type) ?? [];
          resolvers.push((payload) => {
            clearTimeout(timer);
            resolve(payload);
          });
          pending.set(type, resolvers);
        });
      },
    };

    await use(capture);

    // Cleanup
    if (endpointId) {
      await fetch(`${gatewayUrl}/admin/webhooks/${endpointId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      }).catch(() => undefined);
    }
    server.close();
  },
});
