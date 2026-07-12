import type { IIntegrationManager } from "@workspace/contracts";

export abstract class BasePlatform implements IIntegrationManager {
  abstract readonly name: string;
  /** Stable CLI-facing identifier used to select this platform via --platform=. */
  abstract readonly slug: string;
  abstract installHooks(
    cwd: string,
    allowGlobalMcpConfig?: boolean,
  ): Promise<void>;
  abstract uninstallHooks(
    cwd: string,
    allowGlobalMcpConfig?: boolean,
  ): Promise<void>;
}
