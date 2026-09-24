import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { LocalAuthority, WorkplaneController, type Actor } from "@bahulam/workplane-ui";
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
  importLegacyWorkplane,
  PluginStateStorage,
  PluginToolDataProvider,
  type LegacyWorkplane,
} from "@bahulam/workplane-ui/bahulam";
import "@bahulam/workplane-ui/styles.css";
import "./view.css";
import { createAzureDocument, DOCUMENT_ID, OVERVIEW, POLICY } from "./document.js";
import { QUERY_BINDINGS } from "./queries.js";

const PLUGIN = "azure-cost-analyzer";

/**
 * The acting user. Capabilities come from the host session in a real
 * deployment; this view is the local single-user case, and the authority still
 * checks them on every command rather than trusting the UI.
 */
const ACTOR: Actor = {
  id: "local_user",
  type: "user",
  label: "You",
  capabilities: ["workplane.edit"],
};

function Toolbar({
  queries,
  onImportLegacy,
  legacyAvailable,
  notice,
}: {
  queries: number;
  onImportLegacy: () => void;
  legacyAvailable: boolean;
  notice: string | null;
}) {
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
        <div className="wp-actions">
          {legacyAvailable ? (
            <button type="button" onClick={onImportLegacy}>
              Import legacy widgets
            </button>
          ) : null}
          <a href="./index.html">Legacy panel →</a>
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
  const [legacy, setLegacy] = useState<LegacyWorkplane | null>(null);
  const [error, setError] = useState<string | null>(null);

  const renderers = useMemo(() => createNativeRegistry().register(echartsRenderer), []);
  const presenters = useMemo(() => createPresenterRegistry(), []);

  useEffect(() => {
    let disposed = false;
    const client = new BahulamClient({ plugin: PLUGIN });

    const provider = new PluginToolDataProvider({
      client,
      bindings: QUERY_BINDINGS,
      onExecute: () => setQueries((n) => n + 1),
    });

    // Storage lives under `workplane_document`, NOT the legacy `workplane` key,
    // so the existing panel is untouched by anything this view does.
    const storage = new PluginStateStorage({ client, seed: createAzureDocument() });
    const authority = new LocalAuthority({ storage, policy: POLICY });

    const next = new WorkplaneController({
      gateway: authority,
      documentId: DOCUMENT_ID,
      actor: ACTOR,
      provider,
      debounceMs: 250,
    });

    void (async () => {
      try {
        await next.load();
        if (disposed) return;

        if ((next.document?.sceneOrder.length ?? 0) === 0) {
          const result = await next.commit(OVERVIEW);
          if (!result.ok) setNotice(`${result.error.code}: ${result.error.message}`);
        }

        // Offer the legacy import only if there is something to import.
        const existing = await client.getKey<LegacyWorkplane>("workplane");
        if (!disposed && existing?.widgets?.length) setLegacy(existing);

        if (!disposed) setController(next);
      } catch (cause) {
        if (!disposed) {
          setError(
            `Could not reach the Bahulam local service: ${(cause as Error).message}. ` +
              `Open this view from the Bahulam workspace rather than as a file.`,
          );
        }
      }
    })();

    return () => {
      disposed = true;
      next.dispose();
    };
  }, []);

  const importLegacy = useCallback(async () => {
    if (!controller || !legacy) return;
    const operations = importLegacyWorkplane(legacy, {
      sceneId: "imported",
      sceneTitle: "Imported from the legacy panel",
    });
    if (operations.length === 0) return;
    const result = await controller.commit(operations);
    if (result.ok) {
      setLegacy(null);
      setNotice(
        "Imported as a snapshot. Legacy widgets carry literal values, not queries, so these blocks do not refresh.",
      );
    } else {
      setNotice(
        /already exists/.test(result.error.message)
          ? "Those widgets were already imported."
          : `${result.error.code}: ${result.error.message}`,
      );
    }
  }, [controller, legacy]);

  if (error) {
    return <p className="wp-error" role="alert">{error}</p>;
  }
  if (!controller) {
    return <p className="boot">Loading workplane…</p>;
  }

  return (
    <WorkplaneProvider controller={controller} renderers={renderers}>
      <div className="shell">
        <Toolbar
          queries={queries}
          onImportLegacy={() => void importLegacy()}
          legacyAvailable={legacy !== null}
          notice={notice}
        />
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
