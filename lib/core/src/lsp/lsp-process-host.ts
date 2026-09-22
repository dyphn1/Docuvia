import type { INodeProcess } from "@workspace/contracts";
import { NodeProcessProvider } from "../process/process-provider.js";

/** Narrow host-process views injected into LSP resolution code. */
export type ProcessEnvView = Pick<INodeProcess, "env">;
export type ProcessHostView = Pick<INodeProcess, "env" | "platform">;

/** Default Node host adapter; tests may inject a structural view instead. */
export const DEFAULT_LSP_NODE_PROCESS = new NodeProcessProvider();
