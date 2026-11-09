import type { Host } from "@/types/ui-types";

/**
 * Deep-link connect intent parsed from URL query parameters.
 *
 * Grammar:
 *   ?connect=<name|address>&type=<ssh|rdp|vnc|...>&credential=<name>&port=<n>&using=<name|adhoc>
 *
 * `connect` is a saved host name (or IP) by default. When the value does not
 * match a saved host and a type is present — or `using=adhoc` is explicit —
 * the value is treated as an ADDRESS and the launcher builds an ephemeral
 * quick-connect session instead, mirroring Royal TS's rtsx:// ad-hoc mode
 * (`rtsx://vnc%3A%2F%2FVNC@host` means: ad-hoc VNC to host, credential VNC).
 *
 * Mirrors Royal TS's rtsx:// parameter shapes (protocol identifier, URI/name
 * lookup, credential by name) so asset-management URL actions port directly,
 * but intentionally WITHOUT Royal's password= parameter: secrets never travel
 * in URLs or OS argument strings. See the upstream issue for the full spec.
 */
export interface DeepLinkConnectIntent {
  /** Saved host name (or IP) — or, for ad-hoc connects, a raw address. */
  hostName: string;
  /** Optional protocol/tab type; omitted connects with the host default. */
  type?: string;
  /** Optional credential reference by name, resolved at connect time. */
  credentialName?: string;
  /** Optional port override for ad-hoc connects (saved hosts keep theirs). */
  port?: number;
  /** Royal-style lookup control; absent means auto (saved host, then ad-hoc). */
  using?: "adhoc" | "name";
}

/** Every query parameter the deep-link connector claims on a URL. */
export const DEEP_LINK_PARAMS = [
  "connect",
  "type",
  "credential",
  "port",
  "using",
] as const;

const USING_VALUES = ["adhoc", "name"] as const;

/**
 * Returns the search string with all deep-link parameters removed. Other
 * parameters are preserved. Used to scrub the URL so a refresh cannot
 * retrigger a consumed intent.
 */
export function stripDeepLinkParams(search: string): string {
  const params = new URLSearchParams(search);
  for (const key of DEEP_LINK_PARAMS) params.delete(key);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Reads a {@link DeepLinkConnectIntent} from a window-style search string.
 * Pure: reads parameters only; URL mutation is the caller's job (see
 * stripDeepLinkParams). Returns null when there is no connect parameter or
 * its value is empty. Unknown using= values are ignored (auto mode); a port
 * that fails to parse as a positive integer is ignored.
 */
export function parseDeepLinkConnect(
  search: string,
): DeepLinkConnectIntent | null {
  const params = new URLSearchParams(search);
  const hostName = params.get("connect")?.trim() ?? "";
  if (!hostName) return null;
  const rawUsing = params.get("using")?.trim();
  const using = USING_VALUES.find((v) => v === rawUsing);
  const rawPort = params.get("port")?.trim();
  const port = rawPort ? Number.parseInt(rawPort, 10) : undefined;
  return {
    hostName,
    type: params.get("type")?.trim() || undefined,
    credentialName: params.get("credential")?.trim() || undefined,
    port: port != null && !Number.isNaN(port) && port > 0 ? port : undefined,
    using,
  };
}

/**
 * Resolves a parsed intent against the loaded host list. Case-insensitive
 * name match first, exact-IP fallback second: asset inventories may reference
 * either a display name or an address. Explicit using=adhoc skips saved-host
 * lookup entirely.
 */
export function findConnectableHost(
  hosts: readonly Host[],
  intent: Pick<DeepLinkConnectIntent, "hostName" | "using">,
): Host | undefined {
  if (intent.using === "adhoc") return undefined;
  const wanted = intent.hostName.toLowerCase();
  return (
    hosts.find((host) => host.name?.toLowerCase() === wanted) ??
    hosts.find((host) => host.ip === intent.hostName)
  );
}
