const ts = () => new Date().toISOString().slice(11, 19);

function write(stream, label, color, args) {
  // eslint-disable-next-line no-console
  console[stream](`\x1b[2m${ts()}\x1b[0m ${color}${label}\x1b[0m`, ...args);
}

export const log = {
  info: (...args) => write('log', 'info', '\x1b[36m', args),
  ok: (...args) => write('log', ' ok ', '\x1b[32m', args),
  warn: (...args) => write('warn', 'warn', '\x1b[33m', args),
  err: (...args) => write('error', 'fail', '\x1b[31m', args),
};
