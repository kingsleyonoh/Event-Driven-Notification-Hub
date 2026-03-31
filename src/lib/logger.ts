import pino from 'pino';

const rootLogger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  ...(process.env.NODE_ENV === 'development' && {
    transport: {
      target: 'pino/file',
      options: { destination: 1 },
    },
  }),
});

export function createLogger(name: string) {
  return rootLogger.child({ module: name });
}

export { rootLogger as logger };
