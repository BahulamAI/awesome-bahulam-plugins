import { createDocument, type DocumentPolicy, type Operation } from "@bahulam/workplane-ui";

export const DOCUMENT_ID = "wp_azure_cost";
/**
 * Fallback only. Every query result carries the currency Azure reported, and
 * that always wins — this subscription bills in INR while plugin settings say
 * USD, and labelling INR as USD would be an ~85x error, not a cosmetic one.
 */
export const CURRENCY = "USD";

/**
 * Everything a user or an agent may write, typed and bounded. A path absent
 * from here is refused by the authority — not merely hidden in the UI.
 */
export const POLICY: DocumentPolicy = {
  structuralCapability: "workplane.edit",
  writablePaths: [
    { path: "/filters/days", schema: { type: "integer", minimum: 1, maximum: 365 } },
    {
      path: "/filters/dimension",
      schema: { type: "string", enum: ["region", "resource_group", "tag", "resource_type"] },
    },
    {
      path: "/selection/services",
      schema: { type: "array", items: { type: "string", maxLength: 128 }, maxItems: 50 },
    },
  ],
};

export function createAzureDocument() {
  return createDocument({
    id: DOCUMENT_ID,
    title: "Azure cost investigation",
    shared: {
      filters: { days: 30, dimension: "region" },
      selection: { services: [] },
    },
    dataSources: {
      azure_costs: {
        id: "azure_costs",
        provider: "bahulam.plugin.azure-cost-analyzer",
        resource: "azure/cost-management",
        // Set from the tool response so a result can be traced to its read.
        sourceVersion: "unknown",
        schema: { service: "string", cost: "number", date: "date", resource_type: "string" },
        sensitivity: "confidential",
      },
    },
    queries: {
      total_spend: {
        id: "total_spend",
        dataSourceId: "azure_costs",
        spec: { measure: "cost", aggregation: "sum" },
        parameters: { days: { scope: "shared", path: "/filters/days" } },
      },
      cost_by_service: {
        id: "cost_by_service",
        dataSourceId: "azure_costs",
        spec: { measure: "cost", aggregation: "sum", dimension: "service" },
        parameters: { days: { scope: "shared", path: "/filters/days" } },
      },
      spend_trend: {
        id: "spend_trend",
        dataSourceId: "azure_costs",
        spec: { measure: "cost", aggregation: "sum", dimension: "date" },
        parameters: { days: { scope: "shared", path: "/filters/days" } },
      },
      cost_by_dimension: {
        id: "cost_by_dimension",
        dataSourceId: "azure_costs",
        spec: { measure: "cost", aggregation: "sum" },
        parameters: {
          days: { scope: "shared", path: "/filters/days" },
          dimension: { scope: "shared", path: "/filters/dimension" },
        },
      },
    },
  });
}

/** The overview scene, expressed as ordinary operations. */
export const OVERVIEW: readonly Operation[] = [
  { op: "scene.add", scene: { id: "overview", title: "Cost overview", layout: "grid" } },
  {
    op: "block.add",
    sceneId: "overview",
    block: {
      id: "filters",
      kind: "input.filters",
      title: "Filters",
      rendererId: "workplane.form",
      specVersion: "1",
      spec: {
        fields: [
          { name: "days", label: "Look back (days)", control: "number", path: "/filters/days", min: 1, max: 365, step: 1 },
          {
            name: "dimension",
            label: "Break down by",
            control: "select",
            path: "/filters/dimension",
            options: [
              { value: "region", label: "Region" },
              { value: "resource_group", label: "Resource group" },
              { value: "tag", label: "Tag" },
              { value: "resource_type", label: "Resource type" },
            ],
          },
        ],
        submitLabel: "Apply",
      },
      fallback: "Look-back window and breakdown dimension",
    },
  },
  {
    op: "block.add",
    sceneId: "overview",
    block: {
      id: "total_metric",
      kind: "content.metric",
      title: "Total spend",
      rendererId: "workplane.metric",
      specVersion: "1",
      spec: { queryId: "total_spend", column: "total" },
      dataRefs: ["total_spend"],
      fallback: "Total Azure spend over the selected window",
    },
  },
  {
    op: "block.add",
    sceneId: "overview",
    block: {
      id: "by_service",
      kind: "analytics.chart",
      title: "Cost by service",
      rendererId: "workplane.echarts",
      specVersion: "1",
      spec: {
        chartType: "bar",
        queryId: "cost_by_service",
        categoryColumn: "service",
        entityColumn: "serviceId",
        valueColumn: "cost",
        entityType: "azure.service",
        // Highlight rather than filter, so the user keeps context for what
        // they selected against.
        selectionMode: "highlight",
        selectionPath: "/selection/services",
      },
      bindings: { selection: { scope: "shared", path: "/selection/services" } },
      dataRefs: ["cost_by_service"],
      fallback: "Bar chart of Azure cost by service",
    },
  },
  {
    op: "block.add",
    sceneId: "overview",
    block: {
      id: "trend",
      kind: "analytics.chart",
      title: "Daily trend",
      rendererId: "workplane.echarts",
      specVersion: "1",
      spec: { chartType: "line", queryId: "spend_trend", categoryColumn: "date", valueColumn: "cost" },
      dataRefs: ["spend_trend"],
      fallback: "Line chart of daily Azure spend",
    },
  },
  {
    op: "block.add",
    sceneId: "overview",
    block: {
      id: "dimension_table",
      kind: "analytics.table",
      title: "Breakdown",
      rendererId: "workplane.table",
      specVersion: "1",
      spec: { queryId: "cost_by_dimension", columns: ["name", "cost"], pageSize: 12 },
      dataRefs: ["cost_by_dimension"],
      fallback: "Table of Azure cost by the selected dimension",
    },
  },
];
