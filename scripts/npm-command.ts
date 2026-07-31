import { execFileSync } from 'node:child_process';

interface NpmCommandOptions {
  execute?: (
    executable: string,
    args: string[],
    options: { stdio: 'inherit' },
  ) => unknown;
  nodeExecutable?: string;
  npmExecutable?: string | null;
}

export function runNpmScript(
  script: string,
  {
    execute = (executable, args, options) =>
      execFileSync(executable, args, options),
    nodeExecutable = process.execPath,
    npmExecutable = process.env.npm_execpath,
  }: NpmCommandOptions = {},
): void {
  if (!npmExecutable) {
    throw new Error(
      'npm_execpath is unavailable; run this command through npm',
    );
  }

  execute(
    nodeExecutable,
    [npmExecutable, 'run', script],
    { stdio: 'inherit' },
  );
}
