export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  [key: string]: unknown;
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

let logSink: ((line: string) => void) | null = null;

function defaultSink(line: string): void {
  process.stdout.write(`${line}\n`);
}

export function setLogSink(sink: ((line: string) => void) | null): void {
  logSink = sink;
}

function resolveMinLevel(): number {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  return LEVEL_ORDER[raw as LogLevel] ?? LEVEL_ORDER.info;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= resolveMinLevel();
}

function serializeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  return value;
}

function serializeFields(fields?: LogFields): LogFields | undefined {
  if (!fields) {
    return undefined;
  }
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = serializeValue(value);
  }
  return out;
}

function emit(level: LogLevel, msg: string, bindings: LogFields, fields?: LogFields): void {
  if (!shouldLog(level)) {
    return;
  }

  const record: LogFields = {
    level,
    time: new Date().toISOString(),
    service: 'connect-gateway',
    msg,
    ...bindings,
    ...serializeFields(fields),
  };

  let line: string;
  try {
    line = JSON.stringify(record);
  } catch {
    line = JSON.stringify({
      level,
      time: new Date().toISOString(),
      service: 'connect-gateway',
      msg: 'log serialization failed',
    });
  }

  (logSink ?? defaultSink)(line);
}

export function createLogger(bindings: LogFields = {}): Logger {
  return {
    debug(msg, fields) {
      emit('debug', msg, bindings, fields);
    },
    info(msg, fields) {
      emit('info', msg, bindings, fields);
    },
    warn(msg, fields) {
      emit('warn', msg, bindings, fields);
    },
    error(msg, fields) {
      emit('error', msg, bindings, fields);
    },
    child(childBindings) {
      return createLogger({ ...bindings, ...childBindings });
    },
  };
}

export const logger = createLogger();
