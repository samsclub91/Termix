import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { ConfirmOptions } from "@/components/surface/surface-scope";
import type { Host, TabType } from "@/types/ui-types";
import {
  findConnectableHost,
  parseDeepLinkConnect,
  stripDeepLinkParams,
} from "@/shell/deep-link";

/**
 * Consumes a ?connect= deep link exactly once, after the shell has its host
 * list ready. Gating strategy for this first slice is confirm-on-connect,
 * always: every deep link opens the shell confirm dialog before a session
 * starts, so nothing connects from a URL without an explicit click. A
 * user-configurable on/off switch is proposed in the upstream issue.
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
    const host = findConnectableHost(hosts, intent);
    if (!host) {
      toast.error(t("deepLink.hostNotFound", { host: intent.hostName }));
      return;
    }
    const ask = confirmRef?.current;
    void (async () => {
      const ok = ask
        ? await ask({
            title: t("deepLink.confirmTitle", { host: host.name }),
            description: t("deepLink.confirmDescription", {
              host: host.name,
            }),
            confirmLabel: t("deepLink.openAction"),
            destructive: false,
          })
        : true;
      if (ok) connectHost(host, intent.type);
    })();
  }, [hostsLoaded, hosts, connectHost, confirmRef, t]);
}
