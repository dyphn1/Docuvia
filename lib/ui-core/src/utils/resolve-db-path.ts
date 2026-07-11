import path from "path";
import { DOCUVIA_DIR_NAME, LOCAL_DB_FILE_NAME } from "@workspace/contracts";

/** `<workspaceRoot>/.docuvia/local.db` — shared by every workflow that opens the local database. */
export function resolveDbPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, DOCUVIA_DIR_NAME, LOCAL_DB_FILE_NAME);
}
