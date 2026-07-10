import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import glob from "fast-glob";
import chokidar from "chokidar";
import type { FSWatcher } from "chokidar";
import type { Plugin } from "vite";
import {
  MOCKUP_FILE_EXTENSION,
  MOCKUP_IGNORE_GLOBS,
  MOCKUPS_DIR_NAME,
  SRC_DIR_NAME,
} from "./src/constants/mockups";
import {
  DEV_SERVER_LOCALHOST_URL,
  GENERATED_DIR_NAME,
  GENERATED_FILE_EXTENSION,
  GENERATED_FILE_HEADER,
  GENERATED_MODULE_BASENAME,
  GENERATED_MODULE_MAP_TYPE,
  GENERATED_MODULES_EXPORT_CLOSE,
  GENERATED_MODULES_EXPORT_OPEN,
  PLUGIN_NAME,
  WATCHER_ERROR_LOG_PREFIX,
  WATCHER_POLL_INTERVAL_MS,
  WATCHER_STABILITY_THRESHOLD_MS,
} from "./src/constants/mockup-preview-plugin";

export const PLUGIN_CONFIG = {
  name: PLUGIN_NAME,
  mockupsDir: `${SRC_DIR_NAME}/${MOCKUPS_DIR_NAME}`,
  generatedModule: `${SRC_DIR_NAME}/${GENERATED_DIR_NAME}/${GENERATED_MODULE_BASENAME}${GENERATED_FILE_EXTENSION}`,
  localhostUrl: DEV_SERVER_LOCALHOST_URL,
  watcher: {
    stabilityThreshold: WATCHER_STABILITY_THRESHOLD_MS,
    pollInterval: WATCHER_POLL_INTERVAL_MS,
  },
} as const;

interface DiscoveredComponent {
  globKey: string;
  importPath: string;
}

function getMockupsAbsDir(root: string): string {
  return path.join(root, PLUGIN_CONFIG.mockupsDir);
}

function getGeneratedModuleAbsPath(root: string): string {
  return path.join(root, PLUGIN_CONFIG.generatedModule);
}

function isMockupFile(absolutePath: string, root: string): boolean {
  const rel = path.relative(getMockupsAbsDir(root), absolutePath);
  return !rel.startsWith("..") && !path.isAbsolute(rel) && rel.endsWith(MOCKUP_FILE_EXTENSION);
}

function isPreviewTarget(relativeToMockups: string): boolean {
  return relativeToMockups.split(path.sep).every((segment) => !segment.startsWith("_"));
}

async function discoverComponents(root: string): Promise<Array<DiscoveredComponent>> {
  const files = await glob(`${PLUGIN_CONFIG.mockupsDir}/**/*${MOCKUP_FILE_EXTENSION}`, {
    cwd: root,
    ignore: [...MOCKUP_IGNORE_GLOBS],
  });

  const generatedDir = path.posix.dirname(PLUGIN_CONFIG.generatedModule);
  return files.map((f) => ({
    globKey: "./" + f.slice(`${SRC_DIR_NAME}/`.length),
    importPath: path.posix.relative(generatedDir, f),
  }));
}

function generateSource(components: Array<DiscoveredComponent>): string {
  const entries = components
    .map((c) => `  ${JSON.stringify(c.globKey)}: () => import(${JSON.stringify(c.importPath)})`)
    .join(",\n");

  return [
    GENERATED_FILE_HEADER,
    GENERATED_MODULE_MAP_TYPE,
    GENERATED_MODULES_EXPORT_OPEN,
    entries,
    GENERATED_MODULES_EXPORT_CLOSE,
    "",
  ].join("\n");
}

function shouldAutoRescan(pathname: string): boolean {
  return (
    pathname.includes(`/${MOCKUPS_DIR_NAME}/`) ||
    pathname.includes(`/${GENERATED_DIR_NAME}/${GENERATED_MODULE_BASENAME}`)
  );
}

class MockupPreviewManager {
  private root = "";
  private currentSource = "";
  private watcher: FSWatcher | null = null;
  private refreshInFlight = false;
  private refreshQueued = false;
  private initialRefresh: Promise<boolean> | null = null;

  setRoot(root: string): void {
    this.root = root;
  }

  async refresh(): Promise<boolean> {
    if (this.refreshInFlight) {
      this.refreshQueued = true;
      return false;
    }

    this.refreshInFlight = true;
    let changed = false;
    try {
      do {
        this.refreshQueued = false;
        const components = await discoverComponents(this.root);
        const newSource = generateSource(components);
        if (newSource !== this.currentSource) {
          this.currentSource = newSource;
          const generatedModuleAbsPath = getGeneratedModuleAbsPath(this.root);
          mkdirSync(path.dirname(generatedModuleAbsPath), { recursive: true });
          writeFileSync(generatedModuleAbsPath, this.currentSource);
          changed = true;
        }
      } while (this.refreshQueued);
    } finally {
      this.refreshInFlight = false;
    }

    return changed;
  }

  refreshOnce(): Promise<boolean> {
    this.initialRefresh ??= this.refresh();
    return this.initialRefresh;
  }

  async startWatcher(): Promise<void> {
    const mockupsAbsDir = getMockupsAbsDir(this.root);
    mkdirSync(mockupsAbsDir, { recursive: true });

    this.watcher = chokidar.watch(mockupsAbsDir, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: PLUGIN_CONFIG.watcher.stabilityThreshold,
        pollInterval: PLUGIN_CONFIG.watcher.pollInterval,
      },
    });

    this.watcher.on("add", (file) => {
      if (isMockupFile(file, this.root) && isPreviewTarget(path.relative(mockupsAbsDir, file))) {
        void this.refresh();
      }
    });

    this.watcher.on("unlink", (file) => {
      if (isMockupFile(file, this.root)) {
        void this.refresh();
      }
    });

    this.watcher.on("error", (err) => {
      console.error(WATCHER_ERROR_LOG_PREFIX, err);
    });
  }

  async closeWatcher(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }
}

export function mockupPreviewPlugin(): Plugin {
  const manager = new MockupPreviewManager();

  return {
    name: PLUGIN_CONFIG.name,
    enforce: "pre",

    configResolved(config) {
      manager.setRoot(config.root);
    },

    async buildStart() {
      await manager.refreshOnce();
    },

    async configureServer(viteServer) {
      await Promise.all([manager.refreshOnce(), manager.startWatcher()]);

      viteServer.middlewares.use((req, res, next) => {
        const requestUrl = new URL(req.url ?? "/", PLUGIN_CONFIG.localhostUrl);
        const pathname = requestUrl.pathname;

        res.on("finish", () => {
          if (res.statusCode === 404 && shouldAutoRescan(pathname)) {
            void manager.refresh();
          }
        });

        next();
      });
    },

    async closeWatcher() {
      await manager.closeWatcher();
    },
  };
}
