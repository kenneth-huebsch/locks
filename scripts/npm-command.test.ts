import { runNpmScript } from './npm-command.js';

describe('runNpmScript', () => {
  it('uses Node and the npm CLI entrypoint instead of npm.cmd on Windows', () => {
    const execute = vi.fn();

    runNpmScript('build', {
      execute,
      nodeExecutable: 'C:\\Program Files\\nodejs\\node.exe',
      npmExecutable:
        'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js',
    });

    expect(execute).toHaveBeenCalledWith(
      'C:\\Program Files\\nodejs\\node.exe',
      [
        'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js',
        'run',
        'build',
      ],
      { stdio: 'inherit' },
    );
    expect(JSON.stringify(execute.mock.calls)).not.toContain('npm.cmd');
  });

  it('fails clearly when not launched through npm', () => {
    expect(() =>
      runNpmScript('build', {
        execute: vi.fn(),
        nodeExecutable: process.execPath,
        npmExecutable: null,
      }),
    ).toThrow('npm_execpath is unavailable; run this command through npm');
  });
});
