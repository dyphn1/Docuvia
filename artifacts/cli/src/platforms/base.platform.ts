export interface PlatformConfigurator {
  readonly name: string;
  configure(cwd: string): Promise<void>;
}

export abstract class BasePlatform implements PlatformConfigurator {
  abstract readonly name: string;
  abstract configure(cwd: string): Promise<void>;
}
