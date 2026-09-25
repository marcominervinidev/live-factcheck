import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

/** A free TCP port on 127.0.0.1 for a service under test. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address !== null && typeof address === 'object') {
          resolve(address.port);
        } else {
          reject(new Error('no port'));
        }
      });
    });
  });
}

export interface ServiceProcess {
  readonly exitCode: Promise<number | null>;
  /** Everything written to stdout and stderr so far. */
  readonly output: () => string;
  readonly waitFor: (text: string) => Promise<void>;
  readonly kill: (signal: NodeJS.Signals) => void;
}

/**
 * Starts a TypeScript service entry point as a real child process (via tsx, resolving workspace
 * packages to their sources). The environment is exactly `env` plus PATH, so tests control
 * every configuration value.
 */
export function startServiceProcess(entry: string, env: Record<string, string>): ServiceProcess {
  const child = spawn(process.execPath, ['--conditions=development', '--import', 'tsx', entry], {
    env: { PATH: process.env['PATH'] ?? '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const listeners: (() => void)[] = [];
  const onData = (chunk: Buffer) => {
    output += chunk.toString();
    listeners.forEach((listener) => {
      listener();
    });
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  return {
    exitCode: new Promise((resolve) => {
      child.on('exit', (code) => {
        resolve(code);
      });
    }),
    output: () => output,
    waitFor: (text) =>
      new Promise((resolve) => {
        const check = () => {
          if (output.includes(text)) {
            resolve();
          }
        };
        listeners.push(check);
        check();
      }),
    kill: (signal) => child.kill(signal),
  };
}

/** Parses the JSON log lines of a service's output. */
export function jsonLines(output: string): Record<string, unknown>[] {
  return output
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
