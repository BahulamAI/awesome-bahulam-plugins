import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { WorkplaneController, type Actor } from "@bahulam/workplane-ui";
import {
  createNativeRegistry,
  createPresenterRegistry,
  Presenter,
  useControllerState,
  WorkplaneProvider,
} from "@bahulam/workplane-ui/react";
import { echartsRenderer } from "@bahulam/workplane-ui/echarts";
import {
  BahulamClient,
  HttpCommandGateway,
  PluginToolDataProvider,
} from "@bahulam/workplane-ui/bahulam";
import "@bahulam/workplane-ui/styles.css";
import "./view.css";
import { createAzureDocument, DOCUMENT_ID, OVERVIEW, POLICY } from "./document.js";
import { QUERY_BINDINGS } from "./queries.js";

const PLUGIN = "azure-cost-analyzer";

/**
 * Placeholder actor. The HOST derives the real one from the authenticated
 * session and ignores anything sent from here, which is why a panel cannot
 * grant itself capabilities. Kept only because the controller's type requires
 * one.
 */
const ACTOR: Actor = {
  id: "panel",
  type: "user",
  label: "You",
  capabilities: [],
};

function Toolbar({ queries, notice }: { queries: number; notice: string | null }) {
  const { document, epoch } = useControllerState();
  return (
    <>
      <div className="wp-toolbar">
        <div className="wp-stats">
          <span>revision <strong>{document?.revision ?? 0}</strong></span>
          <span>epoch <strong>{epoch.epoch}</strong></span>
          <span>tool reads <strong>{queries}</strong></span>
          {epoch.stale ? <span className="wp-updating">updating…</span> : null}
        </div>

      </div>
      {notice ? <p className="wp-notice" role="status">{notice}</p> : null}
    </>
  );
}

function App() {
  const [controller, setController] = useState<WorkplaneController | null>(null);
  const [queries, setQueries] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const renderers = useMemo(() => createNativeRegistry().register(echartsRenderer), []);
  const presenters = useMemo(() => createPresenterRegistry(), []);

  useEffect(() => {
    let disposed = false;

    // The host loads a panel as /plugin-view/<plugin>/<file>?token=... and
    // authorises every subsequent request. `fromLocation` picks the token up
    // from this page's own URL; without it every call comes back 401.
    const client = BahulamClient.fromLocation(PLUGIN);

    const provider = new PluginToolDataProvider({
      client,
      bindings: QUERY_BINDINGS,
      onExecute: () => setQueries((n) => n + 1),
    });

    // The HOST is the authority. This panel is a client of it, not a second
    // writer — which is what stops the panel and the agent producing
    // conflicting revisions of one document.
    const gateway = new HttpCommandGateway(client);
    gateway.watch(DOCUMENT_ID);

    const next = new WorkplaneController({
      gateway,
      documentId: DOCUMENT_ID,
      actor: ACTOR,
      provider,
      debounceMs: 250,
    });

    void (async () => {
      try {
        await next.load();
        if (disposed) return;

        if (!next.document) {
          setError(
            "The host has no Workplane document for this plugin. Check that plugin.yaml " +
              "declares config.workplane and that the CLI is running a build that serves " +
              "/api/workplane.",
          );
          return;
        }

        if (next.document.sceneOrder.length === 0) {
          const result = await next.commit(OVERVIEW);
          if (!result.ok) setNotice(`${result.error.code}: ${result.error.message}`);
        }

        if (!disposed) setController(next);
      } catch (cause) {
        if (disposed) return;
        const message = (cause as Error).message ?? String(cause);
        const unauthorized = /401|unauthor/i.test(message);
        setError(
          unauthorized
            ? "This panel was opened without a local workspace token, so the host refused " +
              "its requests. Open it from the Bahulam workspace rather than as a file or a " +
              "bookmarked URL."
            : `Could not reach the Bahulam local service: ${message}`,
        );
      }
    })();

    return () => {
      disposed = true;
      next.dispose();
    };
  }, []);


  if (error) {
    return <p className="wp-error" role="alert">{error}</p>;
  }
  if (!controller) {
    return <p className="boot">Loading workplane…</p>;
  }

  return (
    <WorkplaneProvider controller={controller} renderers={renderers}>
      <div className="shell">
        <Toolbar queries={queries} notice={notice} />
        <Presenter controller={controller} registry={presenters} />
        <footer className="wp-footer">
          Figures come from this plugin's own tools, which read credentials inside the host — no
          secret reaches this page. Costs are shown in the currency the tool reports; no conversion
          is applied.
        </footer>
      </div>
    </WorkplaneProvider>
  );
}

const container = document.getElementById("workplane-root");
if (!container) throw new Error("Missing #workplane-root");
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
