import dns from "node:dns/promises";
import net from "node:net";

const LOCAL_HOSTNAMES = new Set(["localhost", "localhost.localdomain"]);

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

export async function assertPublicHttpUrl(rawUrl: string, label = "URL"): Promise<string> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError(`${label} must be a valid URL`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError(`${label} must use http or https`);
  }

  if (url.username || url.password) {
    throw new UnsafeUrlError(`${label} must not contain credentials`);
  }

  await assertPublicHostname(url.hostname, label);
  return url.toString();
}

export async function assertPublicHostname(hostname: string, label = "URL"): Promise<void> {
  const normalizedHostname = hostname.toLowerCase();

  if (!normalizedHostname || LOCAL_HOSTNAMES.has(normalizedHostname)) {
    throw new UnsafeUrlError(`${label} host is not allowed`);
  }
}
