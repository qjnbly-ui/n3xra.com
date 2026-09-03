export type GeometryType = "point" | "line" | "polygon" | "raster";
export type MapsRole = "account_admin" | "editor" | "viewer";

export interface OrganizationAccess {
  organizationId: string;
  organizationName: string;
  role: MapsRole;
}

export interface MapLayer {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  geometry_type: GeometryType;
  feature_kind: "asset" | "reference";
  icon_key: string;
  color: string;
  fill_color: string;
  opacity: number;
  sort_order: number;
  is_visible_by_default: boolean;
  is_searchable: boolean;
  is_editable: boolean;
  source_name: string | null;
  source_url: string | null;
  external_url: string | null;
}

export interface MapFeature {
  id: string;
  organization_id: string;
  layer_id: string;
  title: string;
  reference_code: string | null;
  address: string | null;
  customer_reference: string | null;
  description: string | null;
  status: "active" | "inactive" | "unknown";
  geometry_type: GeometryType;
  geometry: GeoJsonGeometry;
  location_accuracy_m: number | null;
  placement_method: "manual" | "device_gps" | "import" | "external_gnss";
  properties: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface MapLayerField {
  id: string;
  organization_id: string;
  layer_id: string;
  field_key: string;
  label: string;
  field_type: "text" | "number" | "date" | "boolean" | "select";
  options: string[];
  is_required: boolean;
  sort_order: number;
}

export interface MapFeaturePhoto {
  id: string;
  organization_id: string;
  feature_id: string;
  storage_path: string;
  caption: string | null;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

export interface GeoJsonGeometry {
  type: "Point" | "LineString" | "Polygon" | "MultiPoint" | "MultiLineString" | "MultiPolygon";
  coordinates: unknown;
}

export interface MapWorkspaceSnapshot {
  organization: { id: string; name: string };
  role: MapsRole;
  layers: MapLayer[];
  features: MapFeature[];
}

export interface DeviceLocation {
  longitude: number;
  latitude: number;
  accuracyMeters: number;
}
