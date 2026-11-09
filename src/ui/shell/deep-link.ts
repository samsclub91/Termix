import type { Host } from "@/types/ui-types";

/**
 * Deep-link connect intent parsed from URL query parameters.
 *
 * Grammar: ?connect=<host-name>&type=<ssh|rdp|vnc|...>&credential=<name>
 *
 * Mirrors Royal TS's rtsx:// parameter shapes (protocol identifier, URI/name
 * lookup, credential by name) so asset-management URL actions port directly,
 * but intentionally WITHOUT Royal's password= parameter: secrets never travel
 * in URLs or OS argument strings. See upstream issue for the full spec.
 */
export interface DeepLinkConnectIntent {
  /** Host name (or, as a fallback, IP address) to open. */
  hostName: string;
  /** Optional protocol/tab type; omitted connects with the host default. */
  type?: string;
  /** Optional credential reference by name; reserved for a later slice. */
  credentialName?: string;
}

/** Every query parameter the deep-link connector claims on a URL. */
export const DEEP_LINK_PARAMS = ["connect", "type", "credential"] as const;

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
 * its value is empty.
 */
export function parseDeepLinkConnect(
  search: string,
): DeepLinkConnectIntent | null {
  const params = new URLSearchParams(search);
  const hostName = params.get("connect")?.trim() ?? "";
  if (!hostName) return null;
  return {
    hostName,
    type: params.get("type")?.trim() || undefined,
    credentialName: params.get("credential")?.trim() || undefined,
  };
}

/**
 * Resolves a parsed intent against the loaded host list. Case-insensitive
 * name match first, exact-IP fallback second: asset inventories may reference
 * either a display name or an address.
 */
export function findConnectableHost(
  hosts: readonly Host[],
  intent: Pick<DeepLinkConnectIntent, "hostName">,
): Host | undefined {
  const wanted = intent.hostName.toLowerCase();
  return (
    hosts.find((host) => host.name?.toLowerCase() === wanted) ??
    hosts.find((host) => host.ip === intent.hostName)
  );
}
