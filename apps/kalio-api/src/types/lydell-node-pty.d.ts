declare module '@lydell/node-pty' {
  export interface IPty {
    onData(callback: (data: string) => void): { dispose(): void } | void;
    onExit(callback: (event: { exitCode: number }) => void): { dispose(): void } | void;
    kill(signal?: string | number): void;
  }

  export function spawn(
    executable: string,
    args: string[],
    options: {
      name: string;
      cols: number;
      rows: number;
      cwd: string;
      env: NodeJS.ProcessEnv;
    },
  ): IPty;
}
