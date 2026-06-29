import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { QuoteError } from './errors.js';
import { type FxCurrency, type FxOracle, staticFxOracle } from './fx-oracle.js';

const DEFAULT_QUOTE_TTL_MS = 60_000;

export interface QuoteTokenPayload {
  quoteId: string;
  apiKeyId: string;
  from: FxCurrency;
  to: FxCurrency;
  amount: number;
  baseRate: number;
  spreadBps: number;
  effectiveRate: number;
  toAmount: number;
  source: string;
  asOf: string;
  issuedAt: string;
  expiresAt: string;
}

export interface CreateQuoteInput {
  apiKeyId: string;
  from: FxCurrency;
  to: FxCurrency;
  amount: number;
  spreadBps: number;
  oracle?: FxOracle;
  ttlMs?: number;
}

export interface QuoteResult {
  quoteId: string;
  from: FxCurrency;
  to: FxCurrency;
  amount: number;
  baseRate: number;
  spreadBps: number;
  effectiveRate: number;
  toAmount: number;
  source: string;
  asOf: string;
  expiresAt: Date;
  token: string;
}

function getQuoteTtlMs(): number {
  const configured = process.env.QUOTE_TTL_MS;
  if (!configured) {
    return DEFAULT_QUOTE_TTL_MS;
  }

  const parsed = Number(configured);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_QUOTE_TTL_MS;
  }

  return parsed;
}

function getSigningSecret(): string {
  const secret = process.env.GATEWAY_SIGNING_SECRET;
  if (!secret) {
    throw new Error('GATEWAY_SIGNING_SECRET is not configured');
  }

  return secret;
}

function signaturesMatch(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

function computeTokenSignature(encoded: string): string {
  return createHmac('sha256', getSigningSecret()).update(encoded).digest('base64url');
}

export function buildQuoteToken(payload: QuoteTokenPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = computeTokenSignature(encoded);
  return `${encoded}.${signature}`;
}

export function createQuote(input: CreateQuoteInput): QuoteResult {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new QuoteError('quote_invalid', 'amount must be a positive number');
  }

  if (!Number.isInteger(input.spreadBps) || input.spreadBps < 0 || input.spreadBps > 10000) {
    throw new QuoteError('quote_invalid', 'spreadBps must be an integer between 0 and 10000');
  }

  const oracle = input.oracle ?? staticFxOracle;
  const rate = oracle.getRate(input.from, input.to);
  const baseRate = rate.rate;

  // Merchant spread reduces the rate the customer receives.
  const effectiveRate = baseRate * (1 - input.spreadBps / 10000);
  const toAmount = input.amount * effectiveRate;

  const quoteId = `qt_${randomUUID()}`;
  const issuedAt = new Date();
  const ttl = input.ttlMs ?? getQuoteTtlMs();
  const expiresAt = new Date(issuedAt.getTime() + ttl);

  const payload: QuoteTokenPayload = {
    quoteId,
    apiKeyId: input.apiKeyId,
    from: input.from,
    to: input.to,
    amount: input.amount,
    baseRate,
    spreadBps: input.spreadBps,
    effectiveRate,
    toAmount,
    source: rate.source,
    asOf: rate.asOf,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  const token = buildQuoteToken(payload);

  return {
    quoteId,
    from: input.from,
    to: input.to,
    amount: input.amount,
    baseRate,
    spreadBps: input.spreadBps,
    effectiveRate,
    toAmount,
    source: rate.source,
    asOf: rate.asOf,
    expiresAt,
    token,
  };
}

export function verifyQuoteToken(token: string, now?: Date): QuoteTokenPayload {
  const lastDotIndex = token.lastIndexOf('.');
  if (lastDotIndex === -1) {
    throw new QuoteError('quote_invalid', 'Malformed quote token');
  }

  const encoded = token.slice(0, lastDotIndex);
  const signature = token.slice(lastDotIndex + 1);

  if (!encoded || !signature) {
    throw new QuoteError('quote_invalid', 'Malformed quote token');
  }

  const expectedSignature = computeTokenSignature(encoded);
  if (!signaturesMatch(signature, expectedSignature)) {
    throw new QuoteError('quote_invalid', 'Quote token signature mismatch');
  }

  let payload: QuoteTokenPayload;
  try {
    const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
    payload = JSON.parse(decoded) as QuoteTokenPayload;
  } catch {
    throw new QuoteError('quote_invalid', 'Quote token payload is not valid JSON');
  }

  if (new Date(payload.expiresAt).getTime() <= (now ?? new Date()).getTime()) {
    throw new QuoteError('quote_expired', 'Quote has expired');
  }

  return payload;
}
