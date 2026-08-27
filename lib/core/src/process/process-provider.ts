import { INodeProcess } from "@workspace/contracts";

export class NodeProcessProvider implements INodeProcess {
  get env(): NodeJS.ProcessEnv {
    return process.env;
  }
  get version(): string {
    return process.version;
  }
  get platform(): NodeJS.Platform {
    return process.platform;
  }
  get argv(): string[] {
    return process.argv;
  }
  cwd(): string {
    return process.cwd();
  }
}