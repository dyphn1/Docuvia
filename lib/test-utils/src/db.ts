import { runInRollbackTransaction } from "@workspace/db";

export const withRollback = runInRollbackTransaction;
