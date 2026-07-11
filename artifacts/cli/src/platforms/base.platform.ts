export interface PlatformConfigurator {
  readonly name: string;
  /**
   * @param allowGlobalMcpConfig Whether this platform is allowed to write machine-global
   * config (currently only meaningful for `ClaudePlatform`, which gates its global
   * `claude_desktop_config.json` write behind it). Additive parameter — other platforms
   * accept and ignore it since their config writes are already repo-scoped.
   */
  configure(cwd: string, allowGlobalMcpConfig?: boolean): Promise<void>;
}

export abstract class BasePlatform implements PlatformConfigurator {
  abstract readonly name: string;
  abstract configure(cwd: string, allowGlobalMcpConfig?: boolean): Promise<void>;
}
