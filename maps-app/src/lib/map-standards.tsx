import type { GeometryType, MapLayerField } from "./maps-types";

export interface StandardField {
  label: string;
  fieldType: MapLayerField["field_type"];
  options?: string[];
}

export interface LayerPreset {
  key: string;
  group: "Water" | "Sanitary sewer" | "Stormwater" | "Reference";
  name: string;
  description: string;
  geometryType: GeometryType;
  iconKey: string;
  color: string;
  standardNote: string;
  fields: StandardField[];
}

export const MAP_SYMBOLS = [
  ["marker", "General marker"], ["meter", "Water meter"], ["valve", "Water valve"],
  ["hydrant", "Fire hydrant"], ["pump", "Water pump"], ["lift-station", "Lift station"], ["manhole", "Sewer manhole"],
  ["cleanout", "Cleanout"], ["well", "Well"], ["tank", "Storage tank"],
  ["backflow", "Backflow assembly"], ["storm-inlet", "Storm inlet"],
] as const;

const SYMBOL_COLORS: Record<string, string> = {
  marker: "#687C88",
  meter: "#1687E0",
  valve: "#1687E0",
  hydrant: "#D9363E",
  pump: "#1687E0",
  "lift-station": "#168A52",
  manhole: "#168A52",
  cleanout: "#168A52",
  well: "#1687E0",
  tank: "#1687E0",
  backflow: "#1687E0",
  "storm-inlet": "#168A52",
};

const SYMBOL_CONTENT: Record<string, string> = {
  marker: '<path d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11Z"/><circle cx="12" cy="10" r="2.2"/>',
  meter: '<circle cx="12" cy="12" r="8"/><path d="M7.5 14.5a5 5 0 0 1 9 0M12 12l3-3M9 18h6"/>',
  valve: '<path d="M4 8l8 4-8 4V8Zm16 0-8 4 8 4V8ZM12 12V5M9 5h6"/>',
  hydrant: '<path d="M9 21v-3m6 3v-3M8 9h8v9H8V9Zm2-4h4l2 4H8l2-4Zm-5 7h3m8 0h3M5 10v4m14-4v4M10 13h4"/>',
  pump: '<circle cx="11" cy="12" r="7"/><path d="M11 8v4l3 2M18 12h3v6h-5M4 18h14"/>',
  "lift-station": '<rect x="5" y="5" width="14" height="14" rx="2"/><circle cx="12" cy="12" r="4"/><path d="M12 9v3l2 1M8 19v2m8-2v2"/>',
  manhole: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M4 12h16M12 4v16"/>',
  cleanout: '<circle cx="12" cy="12" r="7"/><path d="M15 9a4 4 0 1 0 0 6M12 5V3m0 18v-2"/>',
  well: '<circle cx="12" cy="9" r="5"/><path d="M7 9v8c0 2 10 2 10 0V9M7 14c0 2 10 2 10 0"/>',
  tank: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 4 14 4 14 0V6M5 13c0 4 14 4 14 0"/>',
  backflow: '<path d="M3 12h4m10 0h4M7 8l5 4-5 4V8Zm10 0-5 4 5 4V8ZM9 6h6"/>',
  "storm-inlet": '<rect x="4" y="6" width="16" height="12" rx="2"/><path d="M8 7v10m4-10v10m4-10v10M5 12h14"/>',
};

export function mapSymbolColor(iconKey: string): string {
  return SYMBOL_COLORS[iconKey] || "#687C88";
}

export function mapSymbolMarkup(iconKey: string): string {
  const content = SYMBOL_CONTENT[iconKey] || SYMBOL_CONTENT.marker;
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${content}</svg>`;
}

export function MapSymbol({ iconKey }: { iconKey: string }) {
  return <span className="maps-symbol" aria-hidden="true" dangerouslySetInnerHTML={{ __html: mapSymbolMarkup(iconKey) }} />;
}

export const STANDARD_LAYER_PRESETS: LayerPreset[] = [
  { key: "water-main", group: "Water", name: "Water mains", description: "Potable water distribution mains", geometryType: "line", iconKey: "meter", color: "#1687E0", standardNote: "Blue follows the APWA/811 potable-water identification convention.", fields: [{ label: "Diameter (in)", fieldType: "number" }, { label: "Material", fieldType: "select", options: ["PVC", "Ductile iron", "Cast iron", "HDPE", "Copper", "Other"] }, { label: "Install date", fieldType: "date" }] },
  { key: "water-service", group: "Water", name: "Water service lines", description: "Service connections from the main to customer meters", geometryType: "line", iconKey: "meter", color: "#4AA3DF", standardNote: "Blue identifies potable water; the lighter shade separates services from mains.", fields: [{ label: "Diameter (in)", fieldType: "number" }, { label: "Material", fieldType: "select", options: ["Copper", "PEX", "PVC", "Galvanized", "Other"] }] },
  { key: "water-meter", group: "Water", name: "Water meters", description: "Customer and system water meters", geometryType: "point", iconKey: "meter", color: "#1687E0", standardNote: "Uses the potable-water blue with an original N3XRA meter symbol.", fields: [{ label: "Meter number", fieldType: "text" }, { label: "Size (in)", fieldType: "number" }, { label: "Manufacturer", fieldType: "text" }, { label: "Install date", fieldType: "date" }] },
  { key: "water-valve", group: "Water", name: "Water valves", description: "Isolation, control, and pressure valves", geometryType: "point", iconKey: "valve", color: "#1687E0", standardNote: "Uses a conventional opposed-triangle valve form in N3XRA styling.", fields: [{ label: "Valve type", fieldType: "select", options: ["Gate", "Butterfly", "Ball", "Check", "Pressure reducing", "Other"] }, { label: "Size (in)", fieldType: "number" }, { label: "Normally open", fieldType: "boolean" }] },
  { key: "fire-hydrant", group: "Water", name: "Fire hydrants", description: "Fire protection and flushing hydrants", geometryType: "point", iconKey: "hydrant", color: "#D9363E", standardNote: "The hydrant silhouette is unmistakable; red is used for rapid emergency recognition.", fields: [{ label: "Hydrant number", fieldType: "text" }, { label: "Manufacturer", fieldType: "text" }, { label: "Last flow test", fieldType: "date" }, { label: "In service", fieldType: "boolean" }] },
  { key: "well", group: "Water", name: "Wells", description: "Groundwater production wells", geometryType: "point", iconKey: "well", color: "#1687E0", standardNote: "Blue identifies the potable-water system; the symbol depicts a well casing.", fields: [{ label: "Well number", fieldType: "text" }, { label: "Depth (ft)", fieldType: "number" }, { label: "Capacity (gpm)", fieldType: "number" }] },
  { key: "storage", group: "Water", name: "Storage tanks", description: "Potable water storage tanks and reservoirs", geometryType: "point", iconKey: "tank", color: "#1687E0", standardNote: "Blue identifies potable water with a distinct storage-vessel symbol.", fields: [{ label: "Capacity (gal)", fieldType: "number" }, { label: "Overflow elevation (ft)", fieldType: "number" }] },
  { key: "sewer-main", group: "Sanitary sewer", name: "Sanitary sewer mains", description: "Gravity sanitary sewer collection mains", geometryType: "line", iconKey: "manhole", color: "#168A52", standardNote: "Green follows the APWA/811 sewer and drainage convention.", fields: [{ label: "Diameter (in)", fieldType: "number" }, { label: "Material", fieldType: "select", options: ["PVC", "Concrete", "Clay", "Ductile iron", "Other"] }, { label: "Flow direction", fieldType: "text" }] },
  { key: "sewer-manhole", group: "Sanitary sewer", name: "Sewer manholes", description: "Sanitary sewer access structures", geometryType: "point", iconKey: "manhole", color: "#168A52", standardNote: "Green identifies sewer infrastructure with a plan-view access-cover symbol.", fields: [{ label: "Manhole number", fieldType: "text" }, { label: "Rim elevation (ft)", fieldType: "number" }, { label: "Invert elevation (ft)", fieldType: "number" }] },
  { key: "cleanout", group: "Sanitary sewer", name: "Sewer cleanouts", description: "Sanitary sewer cleanout access points", geometryType: "point", iconKey: "cleanout", color: "#168A52", standardNote: "Green identifies sewer infrastructure; the open-ring symbol distinguishes cleanouts.", fields: [{ label: "Cleanout number", fieldType: "text" }, { label: "Size (in)", fieldType: "number" }] },
  { key: "lift-station", group: "Sanitary sewer", name: "Lift stations", description: "Wastewater lift and pumping stations", geometryType: "point", iconKey: "lift-station", color: "#168A52", standardNote: "Green identifies sewer infrastructure with a dedicated lift-station symbol.", fields: [{ label: "Station number", fieldType: "text" }, { label: "Pump count", fieldType: "number" }, { label: "Capacity (gpm)", fieldType: "number" }] },
  { key: "storm-inlet", group: "Stormwater", name: "Storm inlets", description: "Catch basins and stormwater inlets", geometryType: "point", iconKey: "storm-inlet", color: "#168A52", standardNote: "APWA/811 groups drainage with green; the grate symbol distinguishes stormwater.", fields: [{ label: "Inlet number", fieldType: "text" }, { label: "Inlet type", fieldType: "select", options: ["Catch basin", "Curb inlet", "Grate inlet", "Other"] }] },
  { key: "reclaimed-main", group: "Water", name: "Reclaimed water mains", description: "Reclaimed and non-potable water distribution", geometryType: "line", iconKey: "meter", color: "#8B4FC9", standardNote: "Purple follows the APWA/811 reclaimed-water convention.", fields: [{ label: "Diameter (in)", fieldType: "number" }, { label: "Material", fieldType: "text" }] },
  { key: "service-boundary", group: "Reference", name: "Service area boundary", description: "Organization service territory", geometryType: "polygon", iconKey: "boundary", color: "#647789", standardNote: "Neutral gray keeps reference boundaries distinct from utility-location colors.", fields: [{ label: "Boundary name", fieldType: "text" }, { label: "Effective date", fieldType: "date" }] },
  { key: "parcel", group: "Reference", name: "Tax parcels", description: "Parcel or tax-lot reference boundaries", geometryType: "polygon", iconKey: "boundary", color: "#9AA7B0", standardNote: "Neutral gray prevents reference data from being mistaken for buried utilities.", fields: [{ label: "Parcel number", fieldType: "text" }, { label: "Owner reference", fieldType: "text" }] },
];
