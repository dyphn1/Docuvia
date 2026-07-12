export interface IIntegrationManager {
  installHooks(cwd: string, allowGlobalMcpConfig?: boolean): Promise<void>;
  uninstallHooks(cwd: string, allowGlobalMcpConfig?: boolean): Promise<void>;
}
