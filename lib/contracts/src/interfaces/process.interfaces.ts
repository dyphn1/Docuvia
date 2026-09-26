/**
 * Immutable snapshot of the Presentation host's process environment.
 *
 * This is execution context for subprocess inheritance (PATH/HOME/SSH/proxy/TLS/etc.), not
 * Docuvia application configuration. Presentation owns reading process.env; implementation
 * providers receive this value only through composition and may snapshot it at construction.
 */
export type HostEnvironmentSnapshot = Readonly<
  Record<string, string | undefined>
>;

export interface INodeProcess {
  readonly env: NodeJS.ProcessEnv;
  readonly version: string;
  readonly platform: NodeJS.Platform;
  readonly argv: string[];
  cwd(): string;
}
