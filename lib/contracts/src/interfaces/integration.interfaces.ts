export interface IIntegrationManager {
  installHooks(cwd: string): Promise<void>;
  uninstallHooks(cwd: string): Promise<void>;
}
