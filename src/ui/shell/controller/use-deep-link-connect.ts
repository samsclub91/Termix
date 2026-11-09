import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { ConfirmOptions } from "@/components/surface/surface-scope";
import type { Credential } from "@/types";
import type { Host, TabType } from "@/types/ui-types";
import { listHostProtocols } from "@/sidebar/host-protocols";
import {
  findConnectableHost,
  parseDeepLinkConnect,
  stripDeepLinkParams,
} from "@/shell/deep-link";
import { createQuickConnectHost } from "@/sidebar/quick-connect-host";
import { getCredentialDetails, getCredentials } from "@/api/credentials-api";

/**
 * Consumes a ?connect= deep link exactly once, after the shell has its host
 * list ready and the plugin runtime has settled. Gating strategy for this
 * first slice is confirm-on-connect, always: every deep link opens the shell
 * confirm dialog before a session starts, so nothing connects from a URL
 * without an explicit click. A user-configurable on/off switch is proposed in
 * the upstream issue.
 *
 * Two connect modes:
 *  - Saved host: connect=<name> matches a stored host (or using=name) and it
 *    is opened the way clicking the host in the list does.
 *  - Ad-hoc: connect=<address> with a known type and no saved match (or
 *    using=adhoc) builds an ephemeral quick-connect session on the address,
 *    optionally carrying a credential resolved by NAME from the user's
 *    credential store — the URL itself never carries a secret value.
 *
 * The URL query is always scrubbed of deep-link parameters, whether or not a
 * connect happens, so a refresh can never retrigger the intent.
 */
export function useDeepLinkConnect(options: {
  hostsLoaded: boolean;
  hosts: readonly Host[];
  connectHost: (host: Host, type?: TabType) => void;
  confirmRef?: MutableRefObject<
    ((options: ConfirmOptions) => Promise<boolean>) | null
  >;
  /** Plugin-registry settle flag: deep links must not fire before it settles. */
  pluginsSettled: boolean;
}): void {
  const { hostsLoaded, hosts, connectHost, confirmRef, pluginsSettled } =
    options;
  const { t } = useTranslation();
  const consumedRef = useRef(false);
  // Capture the raw query once: the URL gets scrubbed on the very first
  // effect run, and re-parsing a scrubbed URL on later runs (hosts arriving
  // after mount) would silently drop the intent.
  const bootSearchRef = useRef<string | null>(null);

  useEffect(() => {
    if (bootSearchRef.current === null) {
      bootSearchRef.current = window.location.search;
      const cleaned = stripDeepLinkParams(bootSearchRef.current);
      if (cleaned !== bootSearchRef.current) {
        window.history.replaceState(
          window.history.state,
          "",
          window.location.pathname + cleaned + window.location.hash,
        );
      }
    }
    if (consumedRef.current || !hostsLoaded || !pluginsSettled) return;
    const intent = parseDeepLinkConnect(bootSearchRef.current);
    if (!intent) return;
    // Mark consumed before awaiting anything: the params are already
    // stripped from the URL, so no later run can parse them again.
    consumedRef.current = true;

    const savedHost =
      intent.using === "adhoc" ? undefined : findConnectableHost(hosts, intent);
    if (!savedHost && !intent.type && intent.using !== "adhoc") {
      toast.error(t("deepLink.hostNotFound", { host: intent.hostName }));
      return;
    }
    const coreSsh = !intent.type || intent.type === "ssh";
    // Read the LIVE registry: this effect may run long before or after the
    // plugin runtime registers the rdp/vnc protocols.
    const protocol = coreSsh
      ? undefined
      : listHostProtocols().find((p) => p.id === intent.type);
    if (!savedHost && !coreSsh && !protocol) {
      toast.error(t("deepLink.typeUnknown", { type: intent.type }));
      return;
    }

    void (async () => {
      try {
        let credential: Pick<
          Credential,
          "id" | "username" | "password"
        > | null = null;
        if (!savedHost && intent.credentialName) {
          const list = await getCredentials();
          const wanted = intent.credentialName.toLowerCase();
          const rows = Array.isArray(list) ? list : [];
          const match = rows.find(
            (row) =>
              typeof row?.name === "string" &&
              row.name.toLowerCase() === wanted,
          );
          if (!match) {
            toast.error(
              t("deepLink.credentialNotFound", {
                name: intent.credentialName,
              }),
            );
            return;
          }
          const credId =
            typeof match.id === "number"
              ? match.id
              : Number.parseInt(String(match.id), 10);
          if (!Number.isFinite(credId)) {
            toast.error(
              t("deepLink.credentialNotFound", {
                name: intent.credentialName,
              }),
            );
            return;
          }
          // The credentials LIST redacts the secret; only the detail route
          // (/credentials/:id) returns it.
          const details = (await getCredentialDetails(credId)) as Record<
            string,
            unknown
          >;
          credential = {
            id: credId,
            username: typeof match.username === "string" ? match.username : "",
            password:
              typeof details.password === "string"
                ? details.password
                : typeof details.value === "string"
                  ? details.value
                  : "",
          };
        }

        // connectionType rides the plugin-world host record; core's Host
        // type does not declare it, so widen the local type rather than cast.
        let host: Host & { connectionType?: string };
        const addressLabel =
          credential?.username && savedHost == null
            ? `${credential.username}@${intent.hostName}`
            : intent.hostName;
        if (savedHost) {
          host = savedHost;
        } else if (coreSsh) {
          host = createQuickConnectHost({
            ip: intent.hostName,
            port: intent.port ?? 22,
            username: credential?.username ?? "",
            authType: credential ? "credential" : "none",
            credentialId: credential ? String(credential.id) : undefined,
          });
        } else {
          host = createQuickConnectHost({
            protocol: protocol as NonNullable<typeof protocol>,
            ip: intent.hostName,
            port:
              intent.port ??
              (protocol as NonNullable<typeof protocol>).defaultPort,
            username: credential?.username ?? "",
            authType: credential ? "password" : "none",
            password: credential?.password ?? "",
            domain: intent.domain,
          });
        }
        if (!savedHost) {
          // createQuickConnectHost leaves connectionType unset; without it
          // the plugin-side gate `quickConnectLogin.protocol ===
          // connectionType` drops the auth payload and the session opens
          // unauthenticated.
          host = { ...host, connectionType: intent.type ?? "ssh" };
        }

        const ask = confirmRef?.current;
        const ok = ask
          ? await ask({
              title: t(
                savedHost ? "deepLink.confirmTitle" : "deepLink.adhocTitle",
                {
                  host: savedHost ? host.name : addressLabel,
                },
              ),
              description: t("deepLink.confirmDescription", {
                host: savedHost ? host.name : intent.hostName,
              }),
              confirmLabel: t("deepLink.openAction"),
              destructive: false,
            })
          : true;
        if (ok) connectHost(host, intent.type);
      } catch {
        // Surface a connect failure as an error state instead of vanishing.
        toast.error(t("deepLink.connectFailed"));
      }
    })();
  }, [hostsLoaded, hosts, connectHost, confirmRef, t, pluginsSettled]);
}
