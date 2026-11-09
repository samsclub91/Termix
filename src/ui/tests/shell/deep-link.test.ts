import { describe, expect, it } from "vitest";
import type { Host } from "@/types/ui-types";
import {
  findConnectableHost,
  parseDeepLinkConnect,
  stripDeepLinkParams,
} from "../../shell/deep-link.ts";

describe("parseDeepLinkConnect", () => {
  it("returns null when there is no connect parameter", () => {
    expect(parseDeepLinkConnect("")).toBeNull();
    expect(parseDeepLinkConnect("?foo=bar")).toBeNull();
    expect(parseDeepLinkConnect("?connect")).toBeNull();
    expect(parseDeepLinkConnect("?connect=")).toBeNull();
    expect(parseDeepLinkConnect("?connect=%20%20")).toBeNull();
  });

  it("parses a bare host name", () => {
    expect(parseDeepLinkConnect("?connect=Web%20Server%201")).toEqual({
      hostName: "Web Server 1",
      type: undefined,
      credentialName: undefined,
    });
  });

  it("trims whitespace around the host value", () => {
    expect(parseDeepLinkConnect("?connect=%20web-01%20")?.hostName).toBe(
      "web-01",
    );
  });

  it("parses type and credential alongside the host", () => {
    expect(
      parseDeepLinkConnect("?connect=web-01&type=ssh&credential=Deploy%20Key"),
    ).toEqual({
      hostName: "web-01",
      type: "ssh",
      credentialName: "Deploy Key",
    });
  });

  it("leaves unknown URL parameters in place for stripDeepLinkParams", () => {
    // Parser is pure: it must not reject URLs carrying extra parameters,
    // because other app state may ride the same query string.
    const intent = parseDeepLinkConnect("?connect=web-01&view=dashboard");
    expect(intent?.hostName).toBe("web-01");
  });

  it("parses a valid port and ignores invalid ones", () => {
    expect(parseDeepLinkConnect("?connect=10.0.0.5&port=5900")?.port).toBe(
      5900,
    );
    expect(
      parseDeepLinkConnect("?connect=10.0.0.5&port=0")?.port,
    ).toBeUndefined();
    expect(
      parseDeepLinkConnect("?connect=10.0.0.5&port=-1")?.port,
    ).toBeUndefined();
    expect(
      parseDeepLinkConnect("?connect=10.0.0.5&port=abc")?.port,
    ).toBeUndefined();
  });

  it("parses an explicit using value and ignores unknown ones", () => {
    expect(parseDeepLinkConnect("?connect=web-01&using=adhoc")?.using).toBe(
      "adhoc",
    );
    expect(parseDeepLinkConnect("?connect=web-01&using=name")?.using).toBe(
      "name",
    );
    expect(
      parseDeepLinkConnect("?connect=web-01&using=nonsense")?.using,
    ).toBeUndefined();
    expect(parseDeepLinkConnect("?connect=web-01")?.using).toBeUndefined();
  });
});

describe("stripDeepLinkParams", () => {
  it("removes connect, type, credential, port and using while keeping others", () => {
    expect(
      stripDeepLinkParams(
        "?connect=10.0.0.5&type=vnc&credential=vnc&port=5900&using=adhoc&tab=x",
      ),
    ).toBe("?tab=x");
  });
  it("removes connect, type and credential while keeping others", () => {
    expect(
      stripDeepLinkParams("?connect=web-01&type=ssh&credential=k&tab=x"),
    ).toBe("?tab=x");
  });

  it("returns an empty string when nothing else remains", () => {
    expect(stripDeepLinkParams("?connect=web-01")).toBe("");
  });

  it("returns the original search untouched when no deep-link params exist", () => {
    expect(stripDeepLinkParams("?view=dashboard")).toBe("?view=dashboard");
    expect(stripDeepLinkParams("")).toBe("");
  });
});

describe("findConnectableHost", () => {
  function makeHost(name: string, ip: string): Host {
    return {
      id: name,
      name,
      username: "u",
      ip,
      port: 22,
      folder: "",
      online: false,
      cpu: null,
      ram: null,
      lastAccess: "",
      authType: "password",
      enableSsh: true,
      sshPort: 22,
    };
  }
  const hosts = [
    makeHost("Web Server 1", "192.168.5.16"),
    makeHost("mk-sw1", "192.168.20.2"),
  ];

  it("matches a host by case-insensitive name", () => {
    expect(findConnectableHost(hosts, { hostName: "web server 1" })).toEqual(
      hosts[0],
    );
  });

  it("falls back to an exact IP match", () => {
    expect(findConnectableHost(hosts, { hostName: "192.168.20.2" })).toEqual(
      hosts[1],
    );
  });

  it("skips saved-host lookup entirely when using=adhoc", () => {
    expect(
      findConnectableHost(hosts, { hostName: "Web Server 1", using: "adhoc" }),
    ).toBeUndefined();
  });

  it("returns undefined when nothing matches", () => {
    expect(
      findConnectableHost(hosts, { hostName: "does-not-exist" }),
    ).toBeUndefined();
    expect(findConnectableHost([], { hostName: "web-01" })).toBeUndefined();
    expect(findConnectableHost([], { hostName: "" })).toBeUndefined();
  });
});
