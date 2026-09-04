export type GeometryType = "point" | "line" | "polygon" | "raster";
export type MapsRole = "account_admin" | "editor" | "viewer";
export type MapSystemType = "potable_water" | "sanitary_sewer" | "stormwater" | "reclaimed_water" | "reference" | "other";
export type MapLineEndpointType = "unknown" | "source" | "reservoir" | "dead_end";

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
  standard_key: string | null;
  system_type: MapSystemType;
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
  flow_direction: "unknown" | "start_to_end" | "end_to_start";
  start_endpoint_type: MapLineEndpointType;
  end_endpoint_type: MapLineEndpointType;
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

export interface MapNetworkConnection {
  id: string;
  organization_id: string;
  feature_id: string;
  endpoint: "start" | "end" | `junction:${string}`;
  connected_feature_id: string;
  geometry: GeoJsonGeometry;
  connected_fraction: number;
  snap_distance_m: number;
  created_at: string;
}

export interface MapNetworkDevice {
  id: string;
  organization_id: string;
  device_feature_id: string;
  line_a_feature_id: string;
  line_b_feature_id: string;
  device_type: "valve";
  geometry: GeoJsonGeometry;
  created_at: string;
}

export interface MapPointLineConnection {
  id: string;
  organization_id: string;
  point_feature_id: string;
  line_feature_id: string;
  connection_type: "service_endpoint" | "service_to_main" | "hydrant_lateral" | "access_structure" | "drainage_inlet" | "network_device" | "asset_connection";
  geometry: GeoJsonGeometry;
  line_fraction: number;
  distance_m: number;
  created_at: string;
  updated_at: string;
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

export type MapIncidentStatus = "open" | "responding" | "repairing" | "monitoring" | "resolved";

export interface MapIncident {
  id: string;
  organization_id: string;
  incident_number: number;
  incident_type: "water_main_break";
  feature_id: string;
  reported_geometry: GeoJsonGeometry;
  geometry: GeoJsonGeometry;
  snap_distance_m: number;
  status: MapIncidentStatus;
  severity: "attention" | "urgent" | "emergency";
  title: string;
  initial_report: string | null;
  cause: string | null;
  customers_affected_estimate: number | null;
  repair_method: string | null;
  pressure_lost: boolean;
  disinfected: boolean;
  sample_collected: boolean;
  chlorine_residual: string | null;
  sample_result: string | null;
  customer_reference: string | null;
  request_reference: string | null;
  started_at: string;
  resolved_at: string | null;
  closed_event_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MapIncidentUpdate {
  id: string;
  organization_id: string;
  incident_id: string;
  update_type: "reported" | "crew_dispatched" | "isolation" | "repair_started" | "field_update" | "pressure_restored" | "disinfection" | "sample_collected" | "sample_result" | "customer_notice" | "monitoring" | "resolved";
  status_after: MapIncidentStatus | null;
  note: string;
  details: Record<string, unknown>;
  occurred_at: string;
  created_by_user_id: string;
  submitted_at: string;
}

export type MapIncidentValveStatus = "recommended" | "en_route" | "found" | "closed" | "inaccessible" | "inoperable" | "reopened";

export interface MapIncidentValveAction {
  id: string;
  organization_id: string;
  incident_id: string;
  valve_feature_id: string;
  status: MapIncidentValveStatus;
  note: string | null;
  occurred_at: string;
  created_by_user_id: string | null;
  submitted_at: string;
}

export interface MapIncidentIsolationPlan {
  id: string;
  organization_id: string;
  incident_id: string;
  recommended_valve_ids: string[];
  isolated_feature_ids: string[];
  affected_meter_ids: string[];
  customer_references: string[];
  affected_meter_count: number;
  affected_customer_count: number;
  topology_complete: boolean;
  warnings: string[];
  calculated_at: string;
  updated_at: string;
}
