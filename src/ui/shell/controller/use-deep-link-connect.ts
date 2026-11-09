import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { ConfirmOptions } from "@/components/surface/surface-scope";
import type { Credential } from "@/types";
import type { Host, TabType } from "@/types/ui-types";
import type { HostProtocolDef } from "@/sidebar/host-protocols";
import {
  findConnectableHost,
  parseDeepLinkConnect,
  stripDeepLinkParams,
} from "@/shell/deep-link";
import { createQuickConnectHost } from "@/sidebar/quick-connect-host";
import { getCredentialDetails, getCredentials } from "@/api/credentials-api";

/**
 * Consumes a ?connect= deep link exactly once, after the shell has its host
 * list ready. Gating strategy for this first slice is confirm-on-connect,
 * always: every deep link opens the shell confirm dialog before a session
 * starts, so nothing connects from a URL without an explicit click. A
 * user-configurable on/off switch is proposed in the upstream issue.
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
}): void {
  const { hostsLoaded, hosts, connectHost, confirmRef } = options;
  const { t } = useTranslation();
  const consumedRef = useRef(false);
  const [protocols, setProtocols] = useState<HostProtocolDef[]>([]);

  // Plugin protocols (rdp, vnc, ...) register at runtime; the list may be
  // empty on the very first effect run, so re-run once the registry fills.
  useEffect(() => {
    let cancelled = false;
    void import("@/sidebar/host-protocols").then((mod) => {
      if (cancelled) return;
      setProtocols(mod.listHostProtocols());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const search = window.location.search;
    const cleaned = stripDeepLinkParams(search);
    if (cleaned !== search) {
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + cleaned + window.location.hash,
      );
    }
    if (consumedRef.current || !hostsLoaded) return;
    const intent = parseDeepLinkConnect(search);
    if (!intent) return;
    // Mark consumed before awaiting anything: the params are already stripped
    // from the URL, so no later run of this effect can parse them again.
    consumedRef.current = true;

    const savedHost =
      intent.using === "adhoc" ? undefined : findConnectableHost(hosts, intent);
    if (!savedHost && !intent.type && intent.using !== "adhoc") {
      toast.error(t("deepLink.hostNotFound", { host: intent.hostName }));
      return;
    }
    const coreSsh = !intent.type || intent.type === "ssh";
    const protocol = coreSsh
      ? undefined
      : protocols.find((p) => p.id === intent.type);
    if (!savedHost && !coreSsh && !protocol) {
      // Type requested but no such protocol is registered (yet): the plugin
      // may still be loading — surface the miss instead of a broken tab.
      toast.error(t("deepLink.typeUnknown", { type: intent.type }));
      return;
    }

    void (async () => {
      // The user's credential store is only consulted when the URL asks for
      // one by NAME; a credential's secret value never comes from the URL.
      let credential: Pick<Credential, "id" | "username" | "password"> | null =
        null;
      if (!savedHost && intent.credentialName) {
        try {
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
          credential = {
            id: credId,
            username: typeof match.username === "string" ? match.username : "",
            password:
              typeof match.password === "string"
                ? match.password
                : typeof match.value === "string"
                  ? match.value
                  : "",
          };
          // The credentials LIST redacts the secret (only /credentials/:id
          // returns it); fetch the detail so the session actually gets it.
          if (!credential.password) {
            try {
              const details = (await getCredentialDetails(credId)) as Record<
                string,
                unknown
              >;
              credential = {
                ...credential,
                password:
                  typeof details.password === "string"
                    ? details.password
                    : typeof details.value === "string"
                      ? details.value
                      : credential.password,
              };
            } catch {
              // Leave the empty password; the failed session shows the auth
              // failure rather than swallowing the connect silently.
            }
          }
        } catch {
          toast.error(t("deepLink.credentialFetchFailed"));
          return;
        }
      }

      let host: Host;
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
          protocol: protocol,
          ip: intent.hostName,
          port: intent.port ?? protocol.defaultPort,
          username: credential?.username ?? "",
          authType: credential ? "password" : "none",
          password: credential?.password ?? "",
          domain: intent.domain,
        });
      }

      const ask = confirmRef?.current;
      const ok = ask
        ? await ask({
            title: t(
              savedHost ? "deepLink.confirmTitle" : "deepLink.adhocTitle",
              { host: savedHost ? host.name : addressLabel },
            ),
            description: t("deepLink.confirmDescription", {
              host: savedHost ? host.name : intent.hostName,
            }),
            confirmLabel: t("deepLink.openAction"),
            destructive: false,
          })
        : true;
      if (ok) connectHost(host, intent.type);
    })();
  }, [hostsLoaded, hosts, connectHost, confirmRef, t, protocols]);
}
