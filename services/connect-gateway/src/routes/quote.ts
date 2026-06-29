import type { ApiKey } from '@prisma/client';
import { Hono } from 'hono';
import { QuoteError, quoteErrorStatus, toGatewayErrorBody } from '../errors.js';
import { FxOracleError, isFxCurrency } from '../fx-oracle.js';
import { createQuote } from '../quotes.js';

type QuoteRouteVariables = {
  apiKey: ApiKey;
};

const quote = new Hono<{ Variables: QuoteRouteVariables }>();

quote.post('/', async (c) => {
  const apiKey = c.get('apiKey');
  const body = await c.req.json<{
    from?: string;
    to?: string;
    amount?: number;
  }>();

  const { from, to, amount } = body;

  if (typeof from !== 'string') {
    return c.json(
      toGatewayErrorBody(
        'validation_error',
        'invalid_request',
        'from must be one of CRC, MXN, USD',
      ),
      400,
    );
  }

  if (!isFxCurrency(from)) {
    return c.json(
      toGatewayErrorBody(
        'validation_error',
        'unsupported_currency',
        'from must be one of CRC, MXN, USD',
      ),
      400,
    );
  }

  if (typeof to !== 'string') {
    return c.json(
      toGatewayErrorBody('validation_error', 'invalid_request', 'to must be one of CRC, MXN, USD'),
      400,
    );
  }

  if (!isFxCurrency(to)) {
    return c.json(
      toGatewayErrorBody(
        'validation_error',
        'unsupported_currency',
        'to must be one of CRC, MXN, USD',
      ),
      400,
    );
  }

  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return c.json(
      toGatewayErrorBody('validation_error', 'invalid_request', 'amount must be a positive number'),
      400,
    );
  }

  try {
    const result = createQuote({
      apiKeyId: apiKey.id,
      from,
      to,
      amount,
      spreadBps: apiKey.quoteSpreadBps,
    });

    return c.json({
      quote: {
        quoteId: result.quoteId,
        from: result.from,
        to: result.to,
        amount: result.amount,
        baseRate: result.baseRate,
        spreadBps: result.spreadBps,
        effectiveRate: result.effectiveRate,
        toAmount: result.toAmount,
        source: result.source,
        asOf: result.asOf,
        expiresAt: result.expiresAt.toISOString(),
        token: result.token,
      },
    });
  } catch (error) {
    if (error instanceof QuoteError) {
      return c.json(
        toGatewayErrorBody('quote_error', error.code, error.message),
        quoteErrorStatus(error.code),
      );
    }

    if (error instanceof FxOracleError) {
      return c.json(toGatewayErrorBody('validation_error', error.code, error.message), 400);
    }

    throw error;
  }
});

export { quote as quoteRoutes };
