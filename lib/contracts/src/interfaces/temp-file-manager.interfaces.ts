/** The narrow surface `lib/ui-core`'s init workflow needs from a temp-file manager — see
 *  `lib/core/temp-files/temp-file-manager.ts` for the concrete implementation. */
export interface ITempFileManager {
  initialize(): Promise<void>;
  cleanup(): Promise<void>;
  stopCleanup(): void;
  getTempDirPath(): string;
}
