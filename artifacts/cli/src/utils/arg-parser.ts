import { CLI_FLAGS } from "../constants/cli-flags.js";

/**
 * A simple utility to parse argv flags and positional arguments.
 * Keeps the main CLI switch block clean.
 */
export class ArgParser {
  private args: string[];
  private parsedFlags = new Map<string, string | boolean>();
  private positionals: string[] = [];

  constructor(args: string[]) {
    this.args = args;
    this.parse();
  }

  private parse() {
    for (let i = 0; i < this.args.length; i++) {
      const arg = this.args[i];
      if (arg.startsWith("--")) {
        if (arg.includes("=")) {
          const [key, ...valParts] = arg.split("=");
          this.parsedFlags.set(key, valParts.join("="));
        } else {
          // Check if next arg is a value (not starting with -)
          if (i + 1 < this.args.length && !this.args[i + 1].startsWith("-")) {
            this.parsedFlags.set(arg, this.args[i + 1]);
            i++;
          } else {
            this.parsedFlags.set(arg, true);
          }
        }
      } else if (arg.startsWith("-")) {
        this.parsedFlags.set(arg, true);
      } else {
        this.positionals.push(arg);
      }
    }
  }

  public hasFlag(flag: string): boolean {
    const key = flag.endsWith("=") ? flag.slice(0, -1) : flag;
    return this.parsedFlags.has(key);
  }

  public getFlagValue(flag: string): string | undefined {
    const key = flag.endsWith("=") ? flag.slice(0, -1) : flag;
    const val = this.parsedFlags.get(key);
    return typeof val === "string" ? val : undefined;
  }

  public getPositional(index: number): string | undefined {
    return this.positionals[index];
  }

  public getAllPositionals(): string[] {
    return this.positionals;
  }

  public checkUnknownFlags(allowedFlags: string[]): void {
    const allowedKeys = allowedFlags.map((f) => (f.endsWith("=") ? f.slice(0, -1) : f));
    const unknown = Array.from(this.parsedFlags.keys()).filter((k) => !allowedKeys.includes(k));
    if (unknown.length > 0) {
      throw new Error(`Unknown options provided: ${unknown.join(", ")}`);
    }
  }
}
