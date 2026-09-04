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
  organization_file_id: string | null;
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

export type MapEventType =
  | "water_main_break"
  | "sewer_overflow"
  | "blockage"
  | "valve_inspection"
  | "hydrant_inspection"
  | "backflow_test"
  | "pressure_event"
  | "sample"
  | "inspection"
  | "maintenance"
  | "repair"
  | "replacement"
  | "task_completed"
  | "customer_request"
  | "correction"
  | "void";

export type MapComplianceBasis = "operational" | "recommended" | "organization_policy" | "rule" | "permit";

export interface MapEvent {
  id: string;
  organization_id: string;
  feature_id: string | null;
  sequence_number: number;
  event_type: MapEventType;
  title: string;
  summary: string | null;
  severity: "routine" | "attention" | "urgent" | "emergency";
  compliance_basis: MapComplianceBasis;
  occurred_at: string;
  discovered_at: string | null;
  resolved_at: string | null;
  geometry: GeoJsonGeometry | null;
  details: Record<string, unknown>;
  customer_reference: string | null;
  request_reference: string | null;
  amends_event_id: string | null;
  amendment_kind: "correction" | "void" | null;
  amendment_reason: string | null;
  record_hash: string;
  submitted_at: string;
}

export interface MapTask {
  id: string;
  organization_id: string;
  feature_id: string | null;
  source_event_id: string | null;
  title: string;
  category: "inspection" | "maintenance" | "repair" | "testing" | "sampling" | "reporting" | "customer_request" | "follow_up";
  description: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  status: "open" | "in_progress" | "completed" | "cancelled";
  compliance_basis: MapComplianceBasis;
  compliance_source_name: string | null;
  compliance_source_url: string | null;
  due_at: string | null;
  assigned_to_user_id: string | null;
  customer_reference: string | null;
  request_reference: string | null;
  completed_at: string | null;
  completion_event_id: string | null;
  created_at: string;
  updated_at: string;
}
