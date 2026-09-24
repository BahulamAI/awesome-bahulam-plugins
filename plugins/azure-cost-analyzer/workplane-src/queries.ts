import { toMinorUnits, type ToolQueryBinding } from "@bahulam/workplane-ui/bahulam";
import { CURRENCY } from "./document.js";

/**
 * Binds each Workplane query to one declared plugin tool, and declares the
 * result's column semantics.
 *
 * The declaration matters as much as the data: a renderer must never decide
 * whether a number is a sum, an average, or a ratio, and money is converted to
 * integer minor units HERE — once, at the boundary — rather than rounded
 * separately inside each chart.
 */
const money = (name: string) =>
  ({ name, type: "money" as const, currency: CURRENCY, aggregation: "sum" as const });

const days = (parameters: Record<string, unknown>) => ({
  days: Number(parameters.days ?? 30),
});

interface ServiceRow { name?: string; cost?: unknown }
interface DailyRow { date?: string; cost?: unknown }
/** `azure_cost_by_dimension` returns `{ dimension, values: [{ value, cost }] }`
 *  — the label lives in `value`, which reads oddly but is the tool's shape. */
interface DimensionRow { value?: string; cost?: unknown }

export const QUERY_BINDINGS: readonly ToolQueryBinding[] = [
  {
    queryId: "total_spend",
    tool: "azure_cost_by_service",
    args: days,
    partition: () => "azure:subscription",
    shape: (output) => {
      const o = output as { services?: ServiceRow[]; total?: unknown; currency?: string };
      // Prefer the tool's own total; fall back to summing the breakdown so the
      // metric and the chart cannot disagree.
      const total =
        o.total !== undefined
          ? toMinorUnits(o.total)
          : (o.services ?? []).reduce((sum, row) => sum + toMinorUnits(row.cost), 0);
      return {
        columns: [{ ...money("total"), currency: o.currency ?? CURRENCY }],
        rows: [[total]],
      };
    },
  },
  {
    queryId: "cost_by_service",
    tool: "azure_cost_by_service",
    args: days,
    partition: () => "azure:subscription",
    shape: (output) => {
      const o = output as { services?: ServiceRow[]; currency?: string };
      const rows = (o.services ?? [])
        .map((row) => {
          const label = String(row.name ?? "unknown");
          return [
            // Stable entity id, not the display label: a renamed or localised
            // label must not silently break a saved selection.
            label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
            label,
            toMinorUnits(row.cost),
          ];
        })
        .sort((a, b) => Number(b[2]) - Number(a[2]));
      return {
        columns: [
          { name: "serviceId", type: "string" },
          { name: "service", type: "string" },
          { ...money("cost"), currency: o.currency ?? CURRENCY },
        ],
        rows,
      };
    },
  },
  {
    queryId: "spend_trend",
    tool: "azure_cost_trend",
    args: days,
    partition: () => "azure:subscription",
    shape: (output) => {
      const o = output as { daily_costs?: DailyRow[]; currency?: string };
      return {
        columns: [
          { name: "date", type: "date" },
          { ...money("cost"), currency: o.currency ?? CURRENCY },
        ],
        rows: (o.daily_costs ?? []).map((row) => [String(row.date ?? ""), toMinorUnits(row.cost)]),
      };
    },
  },
  {
    queryId: "cost_by_dimension",
    tool: "azure_cost_by_dimension",
    args: (parameters) => ({
      days: Number(parameters.days ?? 30),
      dimension: String(parameters.dimension ?? "region"),
    }),
    // The dimension is part of the cache key: two breakdowns are two results,
    // not one result that quietly changes meaning.
    partition: (parameters) => `azure:subscription:${String(parameters.dimension ?? "region")}`,
    shape: (output) => {
      const o = output as { values?: DimensionRow[]; currency?: string };
      const rows = (o.values ?? [])
        .map((row) => [String(row.value ?? "unknown"), toMinorUnits(row.cost)])
        .sort((a, b) => Number(b[1]) - Number(a[1]));
      return {
        columns: [
          { name: "name", type: "string" },
          { ...money("cost"), currency: o.currency ?? CURRENCY },
        ],
        rows,
      };
    },
  },
];
