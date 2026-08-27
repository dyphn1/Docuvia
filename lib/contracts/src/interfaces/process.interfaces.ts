export interface INodeProcess {
  readonly env: NodeJS.ProcessEnv;
  readonly version: string;
  readonly platform: NodeJS.Platform;
  readonly argv: string[];
  cwd(): string;
}