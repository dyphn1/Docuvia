import { describe, expect, it } from "vitest";
import { buildGitProcessEnvironment } from "./git-local-provider.js";

describe("buildGitProcessEnvironment", () => {
  it("preserves arbitrary host inheritance keys, applies caller overrides, and pins locale last", () => {
    const hostEnvironment = Object.freeze({
      PATH: "/custom/bin",
      HOME: "/home/tester",
      SSH_AUTH_SOCK: "/tmp/ssh-agent.sock",
      HTTPS_PROXY: "https://proxy.example.test",
      NODE_EXTRA_CA_CERTS: "/etc/company-ca.pem",
      SECRET_TOKEN: "host-secret",
      LC_ALL: "zh_TW.UTF-8",
      LANG: "zh_TW.UTF-8",
      LC_MESSAGES: "zh_TW.UTF-8",
    });

    const env = buildGitProcessEnvironment(hostEnvironment, {
      SECRET_TOKEN: "caller-secret",
      CUSTOM_GIT_CONTEXT: "preserved",
      LANG: "ja_JP.UTF-8",
    });

    expect(env).toMatchObject({
      PATH: "/custom/bin",
      HOME: "/home/tester",
      SSH_AUTH_SOCK: "/tmp/ssh-agent.sock",
      HTTPS_PROXY: "https://proxy.example.test",
      NODE_EXTRA_CA_CERTS: "/etc/company-ca.pem",
      SECRET_TOKEN: "caller-secret",
      CUSTOM_GIT_CONTEXT: "preserved",
      LC_ALL: "C",
      LANG: "C",
      LC_MESSAGES: "C",
    });

    expect(hostEnvironment).toMatchObject({
      SECRET_TOKEN: "host-secret",
      LC_ALL: "zh_TW.UTF-8",
      LANG: "zh_TW.UTF-8",
      LC_MESSAGES: "zh_TW.UTF-8",
    });
  });
});
