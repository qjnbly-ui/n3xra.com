import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import mapboxgl, { GeoJSONSource, Map as MapboxMap, Marker } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  DeviceLocation,
  GeometryType,
  MapComplianceBasis,
  MapEvent,
  MapEventType,
  MapFeature,
  MapFeaturePhoto,
  MapIncident,
  MapIncidentIsolationPlan,
  MapIncidentStatus,
  MapIncidentUpdate,
  MapIncidentValveAction,
  MapIncidentValveStatus,
  MapLayer,
  MapLayerField,
  MapNetworkConnection,
  MapNetworkDevice,
  MapPointLineConnection,
  MapSystemType,
  MapTask,
  MapWorkspaceSnapshot,
  OrganizationAccess,
} from "../lib/maps-types";
import { MAP_SYMBOLS, MapSymbol, STANDARD_LAYER_PRESETS, mapSymbolColor, mapSymbolMarkup } from "../lib/map-standards";
import { isBrandedPortalHostname } from "../../../src/client-portal/tenant-context";

declare global {
  interface Window {
    RECORDS_APP_CONFIG?: {
      supabaseUrl?: string;
      supabaseAnonKey?: string;
    };
  }
}

interface MapsWorkspaceProps {
  mapboxToken: string;
}

interface PointCoordinates {
  longitude: number;
  latitude: number;
  placementMethod: "manual" | "device_gps";
  accuracyMeters: number | null;
}

interface ShapeDraft {
  layerId: string;
  geometryType: "line" | "polygon";
  coordinates: [number, number][];
}

interface ActivationOrganization {
  id: string;
  name: string;
  isOwner: boolean;
  mapsConnected: boolean;
}

interface ActivationOptions {
  approved: boolean;
  activatedOrganizationId: string | null;
  organizations: ActivationOrganization[];
}

interface ArchivedLayer {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  geometry_type: GeometryType;
  icon_key: string;
  color: string;
  archived_at: string;
}

interface ArchivedFeature {
  id: string;
  organization_id: string;
  layer_id: string;
  title: string;
  reference_code: string | null;
  archived_at: string;
}

interface PermanentDeleteTarget {
  type: "layer" | "feature";
  id: string;
  name: string;
}

interface MapsTeamMember {
  membershipId: string;
  userId: string;
  fullName: string;
  email: string | null;
  organizationRole: "account_admin" | "editor" | "viewer";
  mapsRole: "account_admin" | "editor" | "viewer" | null;
  isOwner: boolean;
}

interface MapsTeamSnapshot {
  organization: { id: string; name: string };
  currentUserId: string;
  members: MapsTeamMember[];
}

interface DrivingRouteStep {
  instruction: string;
  roadName: string;
  distanceMeters: number;
  coordinates: [number, number][];
  voiceAnnouncements: string[];
}

interface DrivingRoute {
  distanceMeters: number;
  durationSeconds: number;
  coordinates: [number, number][];
  steps: DrivingRouteStep[];
}

interface NavigationProgress {
  offRouteMeters: number;
  remainingMeters: number;
  remainingSeconds: number;
  stepIndex: number;
}

interface LayerFieldDraft {
  id?: string;
  fieldKey: string;
  label: string;
  fieldType: MapLayerField["field_type"];
  optionsText: string;
  isRequired: boolean;
}

interface NewLayerDraft {
  presetKey: string;
  name: string;
  description: string;
  geometryType: GeometryType;
  iconKey: string;
  color: string;
  systemType: MapSystemType;
}

interface PendingBreakLocation {
  featureId: string;
  longitude: number;
  latitude: number;
}

interface PendingValveLocation {
  featureId: string;
  longitude: number;
  latitude: number;
}

interface LineSnapTarget {
  coordinate: [number, number];
  featureId: string;
  title: string;
  distanceMeters: number;
}

interface PointConnectionCandidate {
  featureId: string;
  featureTitle: string;
  layerName: string;
  distanceMeters: number;
}

interface ShapeAssetConnectionTarget {
  featureId: string;
  title: string;
  coordinate: [number, number];
}

interface IncidentIsolationEstimate {
  requiredValveIds: string[];
  isolatedFeatureIds: string[];
  affectedMeterIds: string[];
  customerReferences: string[];
  topologyComplete: boolean;
  warnings: string[];
}

type GateState = "loading" | "signed-out" | "unassigned" | "setup" | "ready" | "error";
type BasemapStyle = "standard" | "satellite";
type ActivationMode = "existing" | "new";
type AssetPanelTab = "details" | "history" | "tasks" | "files";

const MAP_SYSTEM_OPTIONS: { value: MapSystemType; label: string }[] = [
  { value: "potable_water", label: "Potable water" },
  { value: "sanitary_sewer", label: "Sanitary sewer" },
  { value: "stormwater", label: "Stormwater" },
  { value: "reclaimed_water", label: "Reclaimed water" },
  { value: "reference", label: "Reference / boundary" },
  { value: "other", label: "Other / general" },
];

const EVENT_TYPES: { value: MapEventType; label: string; compliance: MapComplianceBasis }[] = [
  { value: "water_main_break", label: "Water main break", compliance: "rule" },
  { value: "sewer_overflow", label: "Sewer overflow", compliance: "permit" },
  { value: "blockage", label: "Sewer blockage", compliance: "operational" },
  { value: "valve_inspection", label: "Valve inspection / exercise", compliance: "recommended" },
  { value: "hydrant_inspection", label: "Hydrant inspection / flow", compliance: "recommended" },
  { value: "backflow_test", label: "Backflow test", compliance: "rule" },
  { value: "pressure_event", label: "Pressure loss", compliance: "rule" },
  { value: "sample", label: "Water sample", compliance: "rule" },
  { value: "inspection", label: "General inspection", compliance: "operational" },
  { value: "maintenance", label: "Maintenance performed", compliance: "operational" },
  { value: "repair", label: "Repair", compliance: "operational" },
  { value: "replacement", label: "Replacement", compliance: "operational" },
  { value: "customer_request", label: "Customer request", compliance: "operational" },
];

const INCIDENT_UPDATE_TYPES: { value: MapIncidentUpdate["update_type"]; label: string; suggestedStatus: Exclude<MapIncidentStatus, "resolved"> }[] = [
  { value: "crew_dispatched", label: "Crew dispatched", suggestedStatus: "responding" },
  { value: "isolation", label: "Line or area isolated", suggestedStatus: "responding" },
  { value: "repair_started", label: "Repair started", suggestedStatus: "repairing" },
  { value: "field_update", label: "Field update", suggestedStatus: "repairing" },
  { value: "pressure_restored", label: "Pressure restored", suggestedStatus: "monitoring" },
  { value: "disinfection", label: "Disinfection completed", suggestedStatus: "monitoring" },
  { value: "sample_collected", label: "Sample collected", suggestedStatus: "monitoring" },
  { value: "sample_result", label: "Sample result received", suggestedStatus: "monitoring" },
  { value: "customer_notice", label: "Customer notice", suggestedStatus: "responding" },
  { value: "monitoring", label: "Monitoring update", suggestedStatus: "monitoring" },
];

function localDateTimeValue(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatHistoryDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatIncidentAge(value: string): string {
  const minutes = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min active`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} active`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} active`;
}

const WATER_BREAK_ICON_MARKUP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8h5l2.2 2.2M21 8h-5l-2.2 2.2M8 5v6M16 5v6M10.3 15.2l1.7-2.5 1.7 2.5a2 2 0 1 1-3.4 0Z"/></svg>';

function WaterBreakIcon() {
  return <svg className="maps-water-break-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8h5l2.2 2.2M21 8h-5l-2.2 2.2M8 5v6M16 5v6M10.3 15.2l1.7-2.5 1.7 2.5a2 2 0 1 1-3.4 0Z" /></svg>;
}

function eventTypeLabel(type: MapEventType): string {
  return EVENT_TYPES.find((item) => item.value === type)?.label || type.replaceAll("_", " ");
}

function presetSystemType(presetKey: string): MapSystemType {
  if (presetKey === "reclaimed-main") return "reclaimed_water";
  const preset = STANDARD_LAYER_PRESETS.find((item) => item.key === presetKey);
  if (preset?.group === "Water") return "potable_water";
  if (preset?.group === "Sanitary sewer") return "sanitary_sewer";
  if (preset?.group === "Stormwater") return "stormwater";
  if (preset?.group === "Reference") return "reference";
  return "other";
}

function eventDetailsFromForm(form: FormData, eventType: MapEventType): Record<string, unknown> {
  const details: Record<string, unknown> = {};
  const copy = (key: string) => {
    const value = String(form.get(key) || "").trim();
    if (value) details[key] = value;
  };
  if (eventType === "water_main_break") {
    ["cause", "repairMethod", "customersAffected", "chlorineResidual", "sampleResult"].forEach(copy);
    details.pressureLost = form.get("pressureLost") === "on";
    details.disinfected = form.get("disinfected") === "on";
    details.sampleCollected = form.get("sampleCollected") === "on";
  } else if (eventType === "sewer_overflow") {
    ["estimatedVolumeGallons", "volumeMethod", "receivingWater", "cause", "oersIncidentNumber"].forEach(copy);
    details.contained = form.get("contained") === "on";
    details.deqNotified = form.get("deqNotified") === "on";
  } else if (eventType === "valve_inspection") {
    ["condition", "turnsToClose", "normalPosition", "repairsNeeded"].forEach(copy);
    details.operable = form.get("operable") === "on";
  } else if (eventType === "hydrant_inspection") {
    ["condition", "staticPressure", "residualPressure", "flowGpm", "repairsNeeded"].forEach(copy);
    details.drainsProperly = form.get("drainsProperly") === "on";
    details.flushed = form.get("flushed") === "on";
  }
  return details;
}

const ACTIVE_ORGANIZATION_KEY = "records-active-organization-id";
const STANDARD_STYLE = "mapbox://styles/mapbox/standard";
const SATELLITE_STYLE = "mapbox://styles/mapbox/satellite-streets-v12";
const DRIVING_ROUTE_SOURCE_ID = "maps-driving-route";
const DRIVING_ROUTE_CASING_ID = "maps-driving-route-casing";
const DRIVING_ROUTE_LINE_ID = "maps-driving-route-line";
const MAPS_PHOTO_BUCKET = "maps-asset-photos";
const SAVED_SHAPES_SOURCE_ID = "maps-saved-shapes";
const SAVED_SHAPES_FILL_ID = "maps-saved-shapes-fill";
const SAVED_SHAPES_LINE_ID = "maps-saved-shapes-line";
const SAVED_SHAPES_FLOW_ID = "maps-saved-shapes-flow";
const DRAFT_SHAPE_SOURCE_ID = "maps-draft-shape";
const DRAFT_SHAPE_FILL_ID = "maps-draft-shape-fill";
const DRAFT_SHAPE_CASING_ID = "maps-draft-shape-casing";
const DRAFT_SHAPE_LINE_ID = "maps-draft-shape-line";
const DRAFT_SHAPE_VERTICES_ID = "maps-draft-shape-vertices";
const DRAFT_SHAPE_SNAP_ID = "maps-draft-shape-snap";
const LINE_SNAP_PIXELS = 18;
const LINE_SNAP_METERS = 3;

function pointCoordinates(feature: MapFeature): [number, number] | null {
  if (feature.geometry.type !== "Point" || !Array.isArray(feature.geometry.coordinates)) return null;
  const [longitude, latitude] = feature.geometry.coordinates as unknown[];
  if (typeof longitude !== "number" || typeof latitude !== "number") return null;
  return [longitude, latitude];
}

function geoPointCoordinates(geometry: MapIncident["geometry"]): [number, number] | null {
  if (geometry.type !== "Point" || !Array.isArray(geometry.coordinates)) return null;
  const [longitude, latitude] = geometry.coordinates as unknown[];
  return typeof longitude === "number" && typeof latitude === "number" ? [longitude, latitude] : null;
}

function geometryCoordinates(geometry: MapFeature["geometry"]): [number, number][] {
  const pairs: [number, number][] = [];
  const visit = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
      pairs.push([value[0], value[1]]);
      return;
    }
    value.forEach(visit);
  };
  visit(geometry.coordinates);
  return pairs;
}

function shapeGeometry(draft: ShapeDraft): MapFeature["geometry"] {
  if (draft.geometryType === "line") return { type: "LineString", coordinates: draft.coordinates };
  const first = draft.coordinates[0];
  const ring = first ? [...draft.coordinates, first] : draft.coordinates;
  return { type: "Polygon", coordinates: [ring] };
}

function nearestLineSnap(
  map: MapboxMap,
  coordinate: [number, number],
  features: MapFeature[],
  layers: MapLayer[],
  draftLayerId: string,
  excludedFeatureId: string | null,
): LineSnapTarget | null {
  const draftLayer = layers.find((layer) => layer.id === draftLayerId);
  if (!draftLayer || !["potable_water", "sanitary_sewer", "stormwater", "reclaimed_water"].includes(draftLayer.system_type)) return null;
  const pointer = map.project(coordinate);
  let nearest: LineSnapTarget | null = null;
  let nearestPixels = Number.POSITIVE_INFINITY;

  for (const feature of features) {
    if (feature.id === excludedFeatureId || feature.geometry_type !== "line") continue;
    const featureLayer = layers.find((layer) => layer.id === feature.layer_id);
    if (featureLayer?.system_type !== draftLayer.system_type) continue;
    const line = geometryCoordinates(feature.geometry);
    for (let index = 0; index < line.length - 1; index += 1) {
      const start = map.project(line[index]!);
      const end = map.project(line[index + 1]!);
      const deltaX = end.x - start.x;
      const deltaY = end.y - start.y;
      const lengthSquared = deltaX ** 2 + deltaY ** 2;
      const fraction = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
        ((pointer.x - start.x) * deltaX + (pointer.y - start.y) * deltaY) / lengthSquared,
      ));
      const snappedScreen: [number, number] = [start.x + fraction * deltaX, start.y + fraction * deltaY];
      const pixelDistance = Math.hypot(pointer.x - snappedScreen[0], pointer.y - snappedScreen[1]);
      if (pixelDistance > LINE_SNAP_PIXELS || pixelDistance >= nearestPixels) continue;
      const snappedLngLat = map.unproject(snappedScreen);
      const snappedCoordinate: [number, number] = [snappedLngLat.lng, snappedLngLat.lat];
      const distanceMeters = coordinateDistanceMeters(coordinate, snappedCoordinate);
      if (distanceMeters > LINE_SNAP_METERS) continue;
      nearestPixels = pixelDistance;
      nearest = { coordinate: snappedCoordinate, featureId: feature.id, title: feature.title, distanceMeters };
    }
  }
  return nearest;
}

function nearestPointOnFeatureLine(
  map: MapboxMap,
  coordinate: [number, number],
  feature: MapFeature,
): { coordinate: [number, number]; pixelDistance: number } | null {
  const line = geometryCoordinates(feature.geometry);
  if (feature.geometry_type !== "line" || line.length < 2) return null;
  const pointer = map.project(coordinate);
  let nearest: { coordinate: [number, number]; pixelDistance: number } | null = null;
  for (let index = 0; index < line.length - 1; index += 1) {
    const start = map.project(line[index]!);
    const end = map.project(line[index + 1]!);
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const lengthSquared = deltaX ** 2 + deltaY ** 2;
    const fraction = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
      ((pointer.x - start.x) * deltaX + (pointer.y - start.y) * deltaY) / lengthSquared,
    ));
    const snappedScreen: [number, number] = [start.x + fraction * deltaX, start.y + fraction * deltaY];
    const pixelDistance = Math.hypot(pointer.x - snappedScreen[0], pointer.y - snappedScreen[1]);
    if (nearest && pixelDistance >= nearest.pixelDistance) continue;
    const snapped = map.unproject(snappedScreen);
    nearest = { coordinate: [snapped.lng, snapped.lat], pixelDistance };
  }
  return nearest;
}

function nearestCompatiblePointConnection(
  map: MapboxMap | null,
  coordinate: [number, number] | null,
  pointLayer: MapLayer | null | undefined,
  features: MapFeature[],
  layers: MapLayer[],
): PointConnectionCandidate | null {
  if (!map || !coordinate || !pointLayer || pointLayer.geometry_type !== "point" || !["potable_water", "sanitary_sewer", "stormwater", "reclaimed_water"].includes(pointLayer.system_type)) return null;
  const candidates = features.flatMap((feature) => {
    if (feature.geometry_type !== "line") return [];
    const lineLayer = layers.find((layer) => layer.id === feature.layer_id);
    if (!lineLayer || lineLayer.system_type !== pointLayer.system_type) return [];
    const nearest = nearestPointOnFeatureLine(map, coordinate, feature);
    if (!nearest) return [];
    const distanceMeters = coordinateDistanceMeters(coordinate, nearest.coordinate);
    if (distanceMeters > 15) return [];
    const preferred = pointLayer.standard_key === "water-meter" && lineLayer.standard_key === "water-service"
      || pointLayer.standard_key === "fire-hydrant" && lineLayer.standard_key === "water-service"
      || ["sewer-manhole", "cleanout"].includes(pointLayer.standard_key || "") && lineLayer.standard_key === "sewer-main";
    return [{
      featureId: feature.id,
      featureTitle: feature.title,
      layerName: lineLayer.name,
      distanceMeters,
      score: distanceMeters + (preferred ? -0.5 : 0),
    }];
  }).sort((left, right) => left.score - right.score);
  const candidate = candidates[0];
  return candidate ? {
    featureId: candidate.featureId,
    featureTitle: candidate.featureTitle,
    layerName: candidate.layerName,
    distanceMeters: candidate.distanceMeters,
  } : null;
}

function LayerSwatch({ layer }: { layer: Pick<MapLayer, "geometry_type" | "icon_key" | "color"> | null | undefined }) {
  if (!layer) return <i className="maps-layer-swatch is-point" style={{ color: mapSymbolColor("marker") }}><MapSymbol iconKey="marker" /></i>;
  if (layer.geometry_type === "point") return <i className="maps-layer-swatch is-point" style={{ color: mapSymbolColor(layer.icon_key) }}><MapSymbol iconKey={layer.icon_key} /></i>;
  if (layer.geometry_type === "line") return <i className="maps-layer-swatch is-line" style={{ color: layer.color }} />;
  if (layer.geometry_type === "polygon") return <i className="maps-layer-swatch is-area" style={{ color: layer.color, background: `${layer.color}2b` }} />;
  return <i className="maps-layer-swatch is-overlay" aria-hidden="true">▧</i>;
}

function metersBetween(origin: DeviceLocation, feature: MapFeature): number | null {
  const coordinates = pointCoordinates(feature);
  if (!coordinates) return null;
  const [longitude, latitude] = coordinates;
  const radius = 6_371_000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const latitudeDelta = toRadians(latitude - origin.latitude);
  const longitudeDelta = toRadians(longitude - origin.longitude);
  const startLatitude = toRadians(origin.latitude);
  const endLatitude = toRadians(latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function formatDistance(meters: number): string {
  const feet = meters * 3.28084;
  if (feet < 1_000) return `${Math.max(1, Math.round(feet))} ft away`;
  return `${(feet / 5_280).toFixed(2)} mi away`;
}

function calculateIncidentIsolation(
  incident: MapIncident,
  features: MapFeature[],
  layers: MapLayer[],
  networkConnections: MapNetworkConnection[],
  networkDevices: MapNetworkDevice[],
  pointLineConnections: MapPointLineConnection[],
  valveActions: MapIncidentValveAction[],
): IncidentIsolationEstimate {
  const waterLineIds = new Set(features.filter((feature) => {
    const layer = layers.find((item) => item.id === feature.layer_id);
    return feature.geometry_type === "line" && layer?.system_type === "potable_water";
  }).map((feature) => feature.id));
  const devices = networkDevices.filter((device) => waterLineIds.has(device.line_a_feature_id) && waterLineIds.has(device.line_b_feature_id));
  const valvePairs = new Set(devices.map((device) => [device.line_a_feature_id, device.line_b_feature_id].sort().join(":")));
  const adjacency = new Map<string, Set<string>>();
  const connect = (left: string, right: string) => {
    if (!waterLineIds.has(left) || !waterLineIds.has(right)) return;
    if (!adjacency.has(left)) adjacency.set(left, new Set());
    if (!adjacency.has(right)) adjacency.set(right, new Set());
    adjacency.get(left)!.add(right);
    adjacency.get(right)!.add(left);
  };
  networkConnections.forEach((connection) => {
    const pair = [connection.feature_id, connection.connected_feature_id].sort().join(":");
    if (!valvePairs.has(pair)) connect(connection.feature_id, connection.connected_feature_id);
  });

  const latestStatus = new Map<string, MapIncidentValveStatus>();
  valveActions.filter((action) => action.incident_id === incident.id)
    .forEach((action) => latestStatus.set(action.valve_feature_id, action.status));
  const unavailable = new Set([...latestStatus.entries()]
    .filter(([, status]) => status === "inaccessible" || status === "inoperable")
    .map(([featureId]) => featureId));
  const reached = new Set<string>([incident.feature_id]);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const lineId of [...reached]) {
      for (const connectedId of adjacency.get(lineId) || []) {
        if (!reached.has(connectedId)) { reached.add(connectedId); expanded = true; }
      }
    }
    for (const device of devices) {
      if (!unavailable.has(device.device_feature_id)) continue;
      const touchesA = reached.has(device.line_a_feature_id);
      const touchesB = reached.has(device.line_b_feature_id);
      if (touchesA !== touchesB) {
        reached.add(touchesA ? device.line_b_feature_id : device.line_a_feature_id);
        expanded = true;
      }
    }
  }
  const requiredValveIds = devices.filter((device) => reached.has(device.line_a_feature_id) !== reached.has(device.line_b_feature_id))
    .map((device) => device.device_feature_id);
  const affectedMeterIds = pointLineConnections.filter((connection) => reached.has(connection.line_feature_id))
    .map((connection) => features.find((feature) => feature.id === connection.point_feature_id))
    .filter((feature): feature is MapFeature => {
      if (!feature) return false;
      const layer = layers.find((item) => item.id === feature.layer_id);
      return layer?.standard_key === "water-meter" || (layer?.system_type === "potable_water" && layer.icon_key === "meter");
    })
    .map((feature) => feature.id);
  const customerReferences = [...new Set(affectedMeterIds.map((id) => features.find((feature) => feature.id === id)?.customer_reference?.trim()).filter((value): value is string => Boolean(value)))];
  const warnings: string[] = [];
  if (!devices.length) warnings.push("No inserted network valves are mapped in this water system yet.");
  if (devices.length && !requiredValveIds.length) warnings.push("No valve boundary closes around this break. Check line connections and add isolation valves.");
  if (unavailable.size) warnings.push(`${unavailable.size} unavailable valve${unavailable.size === 1 ? " was" : "s were"} bypassed; the plan expanded to the next mapped valve${unavailable.size === 1 ? "" : "s"}.`);
  if (affectedMeterIds.length > customerReferences.length) warnings.push("Some affected meters do not have a customer reference yet.");
  return {
    requiredValveIds,
    isolatedFeatureIds: [...reached],
    affectedMeterIds,
    customerReferences,
    topologyComplete: requiredValveIds.length > 0,
    warnings,
  };
}

function formatRouteDistance(meters: number): string {
  const miles = meters / 1_609.344;
  if (miles < 0.1) return `${Math.max(1, Math.round(meters * 3.28084))} ft`;
  return `${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
}

function formatRouteDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

function coordinateDistanceMeters(left: [number, number], right: [number, number]): number {
  const radius = 6_371_000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const latitudeDelta = toRadians(right[1] - left[1]);
  const longitudeDelta = toRadians(right[0] - left[0]);
  const startLatitude = toRadians(left[1]);
  const endLatitude = toRadians(right[1]);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function nearestCoordinateIndex(coordinates: [number, number][], location: [number, number]): { index: number; distance: number } {
  return coordinates.reduce((nearest, coordinate, index) => {
    const distance = coordinateDistanceMeters(location, coordinate);
    return distance < nearest.distance ? { index, distance } : nearest;
  }, { index: 0, distance: Number.POSITIVE_INFINITY });
}

function navigationProgress(route: DrivingRoute, location: DeviceLocation): NavigationProgress {
  const current: [number, number] = [location.longitude, location.latitude];
  const nearest = nearestCoordinateIndex(route.coordinates, current);
  let remainingMeters = nearest.distance;
  for (let index = nearest.index; index < route.coordinates.length - 1; index += 1) {
    remainingMeters += coordinateDistanceMeters(route.coordinates[index]!, route.coordinates[index + 1]!);
  }
  const stepIndex = route.steps.reduce((nearestStep, step, index) => {
    if (!step.coordinates.length) return nearestStep;
    const distance = nearestCoordinateIndex(step.coordinates, current).distance;
    return distance < nearestStep.distance ? { index, distance } : nearestStep;
  }, { index: 0, distance: Number.POSITIVE_INFINITY }).index;
  return {
    offRouteMeters: nearest.distance,
    remainingMeters,
    remainingSeconds: route.distanceMeters > 0 ? route.durationSeconds * (remainingMeters / route.distanceMeters) : 0,
    stepIndex,
  };
}

function fieldKeyFromLabel(label: string, fallback: string): string {
  const normalized = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const prefixed = /^[a-z]/.test(normalized) ? normalized : `field_${normalized}`;
  return (prefixed || fallback).slice(0, 50);
}

function readCustomProperties(form: FormData, fields: MapLayerField[]): Record<string, unknown> {
  return Object.fromEntries(fields.map((field) => {
    const name = `custom_${field.field_key}`;
    if (field.field_type === "boolean") return [field.field_key, form.get(name) === "on"];
    const value = String(form.get(name) || "").trim();
    if (!value) return [field.field_key, null];
    if (field.field_type === "number") {
      const numberValue = Number(value);
      return [field.field_key, Number.isFinite(numberValue) ? numberValue : value];
    }
    return [field.field_key, value];
  }));
}

function mapsRoleLabel(role: MapsTeamMember["mapsRole"]): string {
  return role === "account_admin" ? "Administrator" : role === "editor" ? "Editor" : role === "viewer" ? "Viewer" : "No access";
}

export default function MapsWorkspace({ mapboxToken }: MapsWorkspaceProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const featureMarkersRef = useRef<Map<string, Marker>>(new Map());
  const incidentMarkersRef = useRef<Map<string, Marker>>(new Map());
  const shapeVertexMarkersRef = useRef<Marker[]>([]);
  const locationMarkerRef = useRef<Marker | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const locationRequestTimerRef = useRef<number | null>(null);
  const locationRequestIdRef = useRef(0);
  const pendingDirectionsTargetRef = useRef<string | null>(null);
  const navigationActiveRef = useRef(false);
  const lastRerouteAtRef = useRef(0);
  const spokenStepIndexRef = useRef<number | null>(null);
  const fittedOrganizationRef = useRef<string | null>(null);
  const currentBasemapRef = useRef<BasemapStyle>("standard");
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [dashboardDestination, setDashboardDestination] = useState({ href: "/account/", label: "Dashboard" });
  const [gate, setGate] = useState<GateState>("loading");
  const [gateMessage, setGateMessage] = useState("Opening your maps workspace…");
  const [accessList, setAccessList] = useState<OrganizationAccess[]>([]);
  const [activeAccess, setActiveAccess] = useState<OrganizationAccess | null>(null);
  const [layers, setLayers] = useState<MapLayer[]>([]);
  const [features, setFeatures] = useState<MapFeature[]>([]);
  const [layerFields, setLayerFields] = useState<MapLayerField[]>([]);
  const [featurePhotos, setFeaturePhotos] = useState<MapFeaturePhoto[]>([]);
  const [mapEvents, setMapEvents] = useState<MapEvent[]>([]);
  const [mapTasks, setMapTasks] = useState<MapTask[]>([]);
  const [mapIncidents, setMapIncidents] = useState<MapIncident[]>([]);
  const [mapIncidentUpdates, setMapIncidentUpdates] = useState<MapIncidentUpdate[]>([]);
  const [networkConnections, setNetworkConnections] = useState<MapNetworkConnection[]>([]);
  const [networkDevices, setNetworkDevices] = useState<MapNetworkDevice[]>([]);
  const [pointLineConnections, setPointLineConnections] = useState<MapPointLineConnection[]>([]);
  const [incidentValveActions, setIncidentValveActions] = useState<MapIncidentValveAction[]>([]);
  const [incidentIsolationPlans, setIncidentIsolationPlans] = useState<MapIncidentIsolationPlan[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [layerFieldDrafts, setLayerFieldDrafts] = useState<LayerFieldDraft[]>([]);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [visibleLayers, setVisibleLayers] = useState<Record<string, boolean>>({});
  const [showPastBreaks, setShowPastBreaks] = useState(false);
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [assetPanelTab, setAssetPanelTab] = useState<AssetPanelTab>("details");
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [eventType, setEventType] = useState<MapEventType>("inspection");
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [taskCompleting, setTaskCompleting] = useState<MapTask | null>(null);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [breakPlacementFeatureId, setBreakPlacementFeatureId] = useState<string | null>(null);
  const [pendingBreakLocation, setPendingBreakLocation] = useState<PendingBreakLocation | null>(null);
  const [breakStartDialogOpen, setBreakStartDialogOpen] = useState(false);
  const [valvePlacementFeatureId, setValvePlacementFeatureId] = useState<string | null>(null);
  const [pendingValveLocation, setPendingValveLocation] = useState<PendingValveLocation | null>(null);
  const [valveDialogOpen, setValveDialogOpen] = useState(false);
  const [valveLayerId, setValveLayerId] = useState("");
  const [incidentUpdateDialogOpen, setIncidentUpdateDialogOpen] = useState(false);
  const [incidentUpdateType, setIncidentUpdateType] = useState<MapIncidentUpdate["update_type"]>("field_update");
  const [incidentUpdateStatus, setIncidentUpdateStatus] = useState<Exclude<MapIncidentStatus, "resolved">>("repairing");
  const [incidentCloseDialogOpen, setIncidentCloseDialogOpen] = useState(false);
  const [selectedLayerId, setSelectedLayerId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [basemap, setBasemap] = useState<BasemapStyle>("standard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [layerDialogOpen, setLayerDialogOpen] = useState(false);
  const [newLayerDraft, setNewLayerDraft] = useState<NewLayerDraft>({ presetKey: "", name: "", description: "", geometryType: "point", iconKey: "marker", color: mapSymbolColor("marker"), systemType: "other" });
  const [editingLayer, setEditingLayer] = useState<MapLayer | null>(null);
  const [editingLayerIconKey, setEditingLayerIconKey] = useState("marker");
  const [layerArchiveOpen, setLayerArchiveOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archivedLayers, setArchivedLayers] = useState<ArchivedLayer[]>([]);
  const [archivedFeatures, setArchivedFeatures] = useState<ArchivedFeature[]>([]);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState<PermanentDeleteTarget | null>(null);
  const [featureDialogOpen, setFeatureDialogOpen] = useState(false);
  const [featureEditOpen, setFeatureEditOpen] = useState(false);
  const [featureDeleteOpen, setFeatureDeleteOpen] = useState(false);
  const [movingFeatureId, setMovingFeatureId] = useState<string | null>(null);
  const [proposedMove, setProposedMove] = useState<PointCoordinates | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [placementMode, setPlacementMode] = useState(false);
  const [pendingPoint, setPendingPoint] = useState<PointCoordinates | null>(null);
  const [connectNewPoint, setConnectNewPoint] = useState(false);
  const [shapeDraft, setShapeDraft] = useState<ShapeDraft | null>(null);
  const [pendingShape, setPendingShape] = useState<ShapeDraft | null>(null);
  const [shapeAssetConnectionTargets, setShapeAssetConnectionTargets] = useState<ShapeAssetConnectionTarget[]>([]);
  const [shapeHoverCoordinate, setShapeHoverCoordinate] = useState<[number, number] | null>(null);
  const [shapeSnapTarget, setShapeSnapTarget] = useState<LineSnapTarget | null>(null);
  const [editingShapeId, setEditingShapeId] = useState<string | null>(null);
  const [selectedShapeVertexIndex, setSelectedShapeVertexIndex] = useState<number | null>(null);
  const [shapeEditHistory, setShapeEditHistory] = useState<[number, number][][]>([]);
  const [shapeEditReview, setShapeEditReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [deviceLocation, setDeviceLocation] = useState<DeviceLocation | null>(null);
  const [locationError, setLocationError] = useState("");
  const [locating, setLocating] = useState(false);
  const [directionsTargetId, setDirectionsTargetId] = useState<string | null>(null);
  const [drivingRoute, setDrivingRoute] = useState<DrivingRoute | null>(null);
  const [directionsLoading, setDirectionsLoading] = useState(false);
  const [directionsError, setDirectionsError] = useState("");
  const [navigationActive, setNavigationActive] = useState(false);
  const [navigationArrived, setNavigationArrived] = useState(false);
  const [navigationProgressState, setNavigationProgressState] = useState<NavigationProgress | null>(null);
  const [navigationHeading, setNavigationHeading] = useState<number | null>(null);
  const [navigationSpeedMps, setNavigationSpeedMps] = useState<number | null>(null);
  const [voiceGuidance, setVoiceGuidance] = useState(true);
  const [activationOptions, setActivationOptions] = useState<ActivationOptions | null>(null);
  const [activationMode, setActivationMode] = useState<ActivationMode>("existing");
  const [activationOrganizationId, setActivationOrganizationId] = useState("");
  const [newOrganizationName, setNewOrganizationName] = useState("");
  const [activating, setActivating] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamSnapshot, setTeamSnapshot] = useState<MapsTeamSnapshot | null>(null);
  const [teamSavingUserId, setTeamSavingUserId] = useState<string | null>(null);

  const canEdit = activeAccess?.role === "account_admin" || activeAccess?.role === "editor";
  const canManageLayers = activeAccess?.role === "account_admin";
  const canPermanentlyDelete = activeAccess?.role === "account_admin";

  useEffect(() => {
    setDashboardDestination(isBrandedPortalHostname()
      ? { href: "/client-portal/", label: "Return to dashboard" }
      : { href: "/account/", label: "Dashboard" });
  }, []);
  const selectedFeature = features.find((feature) => feature.id === selectedFeatureId) || null;
  const selectedLayer = layers.find((layer) => layer.id === selectedFeature?.layer_id);
  const selectedFeatureSupportsWaterBreak = selectedFeature?.geometry_type === "line" && selectedLayer?.system_type === "potable_water";
  const valveLayers = layers.filter((layer) => layer.geometry_type === "point" && layer.system_type === "potable_water" && layer.is_editable && (layer.icon_key === "valve" || layer.standard_key === "water-valve"));
  const selectedDistance = selectedFeature && deviceLocation ? metersBetween(deviceLocation, selectedFeature) : null;
  const directionsTarget = features.find((feature) => feature.id === directionsTargetId) || null;
  const selectedFields = layerFields.filter((field) => field.layer_id === selectedFeature?.layer_id);
  const selectedPhotos = featurePhotos.filter((photo) => photo.feature_id === selectedFeatureId);
  const selectedEvents = mapEvents.filter((event) => event.feature_id === selectedFeatureId)
    .sort((left, right) => new Date(right.occurred_at).getTime() - new Date(left.occurred_at).getTime());
  const selectedTasks = mapTasks.filter((task) => task.feature_id === selectedFeatureId && task.status !== "cancelled")
    .sort((left, right) => (left.status === "completed" ? 1 : 0) - (right.status === "completed" ? 1 : 0)
      || new Date(left.due_at || "9999-12-31").getTime() - new Date(right.due_at || "9999-12-31").getTime());
  const selectedNetworkConnections = networkConnections.filter((connection) => connection.feature_id === selectedFeatureId || connection.connected_feature_id === selectedFeatureId);
  const selectedPointLineConnection = pointLineConnections.find((connection) => connection.point_feature_id === selectedFeatureId) || null;
  const selectedConnectedLine = features.find((feature) => feature.id === selectedPointLineConnection?.line_feature_id) || null;
  const selectedConnectedLineLayer = layers.find((layer) => layer.id === selectedConnectedLine?.layer_id) || null;
  const activeIncidents = useMemo(() => mapIncidents.filter((incident) => incident.status !== "resolved")
    .sort((left, right) => new Date(right.started_at).getTime() - new Date(left.started_at).getTime()), [mapIncidents]);
  const historicalIncidents = useMemo(() => mapIncidents.filter((incident) => incident.status === "resolved")
    .sort((left, right) => new Date(right.resolved_at || right.started_at).getTime() - new Date(left.resolved_at || left.started_at).getTime()), [mapIncidents]);
  const visibleIncidents = useMemo(() => showPastBreaks ? [...activeIncidents, ...historicalIncidents] : activeIncidents, [activeIncidents, historicalIncidents, showPastBreaks]);
  const historicalIncidentByEventId = useMemo(() => new Map(historicalIncidents
    .filter((incident) => incident.closed_event_id)
    .map((incident) => [incident.closed_event_id as string, incident])), [historicalIncidents]);
  const selectedIncident = mapIncidents.find((incident) => incident.id === selectedIncidentId) || null;
  const selectedIncidentCloseEvent = selectedIncident?.closed_event_id
    ? mapEvents.find((event) => event.id === selectedIncident.closed_event_id) || null
    : null;
  const selectedIncidentUpdates = mapIncidentUpdates.filter((update) => update.incident_id === selectedIncidentId)
    .sort((left, right) => new Date(left.occurred_at).getTime() - new Date(right.occurred_at).getTime());
  const selectedIsolationEstimate = useMemo(() => selectedIncident ? calculateIncidentIsolation(
    selectedIncident, features, layers, networkConnections, networkDevices, pointLineConnections, incidentValveActions,
  ) : null, [features, incidentValveActions, layers, networkConnections, networkDevices, pointLineConnections, selectedIncident]);
  const selectedSavedIsolationPlan = incidentIsolationPlans.find((plan) => plan.incident_id === selectedIncidentId) || null;
  const selectedValveStatuses = useMemo(() => {
    const statuses = new Map<string, MapIncidentValveStatus>();
    incidentValveActions.filter((action) => action.incident_id === selectedIncidentId)
      .forEach((action) => statuses.set(action.valve_feature_id, action.status));
    return statuses;
  }, [incidentValveActions, selectedIncidentId]);
  const selectedIsolationValves = useMemo(() => {
    if (!selectedIncident || !selectedIsolationEstimate) return [];
    const incidentLocation = geoPointCoordinates(selectedIncident.geometry);
    return selectedIsolationEstimate.requiredValveIds.map((id) => features.find((feature) => feature.id === id))
      .filter((feature): feature is MapFeature => Boolean(feature))
      .sort((left, right) => {
        if (!incidentLocation) return left.title.localeCompare(right.title);
        const origin = { longitude: incidentLocation[0], latitude: incidentLocation[1], accuracyMeters: 0 };
        return (metersBetween(origin, left) ?? Number.MAX_VALUE) - (metersBetween(origin, right) ?? Number.MAX_VALUE);
      });
  }, [features, selectedIncident, selectedIsolationEstimate]);
  const selectedUnavailableValves = useMemo(() => [...selectedValveStatuses.entries()]
    .filter(([, status]) => status === "inaccessible" || status === "inoperable")
    .map(([featureId, status]) => ({ feature: features.find((feature) => feature.id === featureId), status }))
    .filter((item): item is { feature: MapFeature; status: MapIncidentValveStatus } => Boolean(item.feature)), [features, selectedValveStatuses]);
  const highlightedIsolationFeatureIds = useMemo(() => new Set(
    selectedIncidentId
      ? (selectedIncident?.status === "resolved" ? selectedSavedIsolationPlan?.isolated_feature_ids : selectedIsolationEstimate?.isolatedFeatureIds) || []
      : [],
  ), [selectedIncident?.status, selectedIncidentId, selectedIsolationEstimate, selectedSavedIsolationPlan]);
  const activeIncidentFeatureIds = useMemo(() => new Set(activeIncidents.map((incident) => incident.feature_id)), [activeIncidents]);
  const activeDrawingLayer = layers.find((layer) => layer.id === selectedLayerId && layer.is_editable) || null;
  const selectedNewLayerPreset = STANDARD_LAYER_PRESETS.find((preset) => preset.key === newLayerDraft.presetKey) || null;
  const pendingPointConnectionCandidate = useMemo(() => nearestCompatiblePointConnection(
    mapRef.current,
    pendingPoint ? [pendingPoint.longitude, pendingPoint.latitude] : null,
    layers.find((layer) => layer.id === selectedLayerId),
    features,
    layers,
  ), [features, layers, pendingPoint, selectedLayerId]);
  const selectedPointConnectionCandidate = useMemo(() => nearestCompatiblePointConnection(
    mapRef.current,
    selectedFeature ? pointCoordinates(selectedFeature) : null,
    selectedLayer,
    features.filter((feature) => feature.id !== selectedFeatureId),
    layers,
  ), [features, layers, selectedFeature, selectedFeatureId, selectedLayer]);

  useEffect(() => {
    if (!featureDialogOpen) return;
    setConnectNewPoint(Boolean(pendingPointConnectionCandidate));
  }, [featureDialogOpen, pendingPointConnectionCandidate]);

  const openIncident = useCallback((incident: MapIncident) => {
    setSelectedFeatureId(incident.feature_id);
    setSelectedIncidentId(incident.id);
    setSidebarOpen(false);
  }, []);

  const openHistoricalIncident = useCallback((incident: MapIncident) => {
    setShowPastBreaks(true);
    openIncident(incident);
    const coordinates = geoPointCoordinates(incident.geometry);
    if (coordinates) mapRef.current?.easeTo({ center: coordinates, zoom: Math.max(mapRef.current.getZoom(), 17), duration: 650 });
  }, [openIncident]);

  const chooseLayerPreset = (presetKey: string) => {
    const preset = STANDARD_LAYER_PRESETS.find((item) => item.key === presetKey);
    if (!preset) {
      setNewLayerDraft((current) => ({ ...current, presetKey: "" }));
      return;
    }
    setNewLayerDraft({ presetKey: preset.key, name: preset.name, description: preset.description, geometryType: preset.geometryType, iconKey: preset.iconKey, color: preset.color, systemType: presetSystemType(preset.key) });
  };

  const chooseLayerGeometry = (geometryType: GeometryType) => {
    setNewLayerDraft((current) => ({
      ...current,
      presetKey: "",
      geometryType,
      iconKey: geometryType === "point" ? current.iconKey : "marker",
      color: geometryType === "point" ? mapSymbolColor(current.iconKey) : current.color,
    }));
  };

  const choosePointSymbol = (iconKey: string) => {
    setNewLayerDraft((current) => ({ ...current, presetKey: "", iconKey, color: mapSymbolColor(iconKey) }));
  };

  const filteredFeatures = useMemo(() => {
    const query = search.trim().toLowerCase();
    return features
      .filter((feature) => visibleLayers[feature.layer_id] !== false)
      .filter((feature) => {
        if (!query) return true;
        const layer = layers.find((item) => item.id === feature.layer_id);
        return [feature.title, feature.reference_code || "", feature.address || "", feature.customer_reference || "", feature.description || "", Object.values(feature.properties || {}).join(" "), layer?.name || ""]
          .some((value) => value.toLowerCase().includes(query));
      })
      .sort((left, right) => left.title.localeCompare(right.title));
  }, [features, layers, search, visibleLayers]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3_000);
  }, []);

  const connectLineDrawingToAsset = useCallback((feature: MapFeature): boolean => {
    if (!shapeDraft || shapeDraft.geometryType !== "line" || editingShapeId) return false;
    const coordinate = pointCoordinates(feature);
    const lineLayer = layers.find((layer) => layer.id === shapeDraft.layerId);
    const assetLayer = layers.find((layer) => layer.id === feature.layer_id);
    if (!coordinate || !lineLayer || !assetLayer) return false;
    if (lineLayer.system_type === "other" || lineLayer.system_type === "reference" || lineLayer.system_type !== assetLayer.system_type) {
      showToast(`${feature.title} is not part of this utility system`);
      return true;
    }
    const lastCoordinate = shapeDraft.coordinates.at(-1);
    if (lastCoordinate && coordinateDistanceMeters(lastCoordinate, coordinate) < 0.05) {
      showToast(`${feature.title} is already the line endpoint`);
      return true;
    }
    const nextDraft = { ...shapeDraft, coordinates: [...shapeDraft.coordinates, coordinate] };
    setShapeAssetConnectionTargets((current) => current.some((target) => target.featureId === feature.id)
      ? current
      : [...current, { featureId: feature.id, title: feature.title, coordinate }]);
    setSelectedFeatureId(null);
    setShapeHoverCoordinate(null);
    setShapeSnapTarget(null);
    if (nextDraft.coordinates.length >= 2) {
      setPendingShape(nextDraft);
      setShapeDraft(null);
      showToast(`Line snapped to ${feature.title}`);
    } else {
      setShapeDraft(nextDraft);
      showToast(`Line started at ${feature.title}`);
    }
    return true;
  }, [editingShapeId, layers, shapeDraft, showToast]);

  useEffect(() => {
    setAssetPanelTab("details");
  }, [selectedFeatureId]);

  const drawDrivingRoute = useCallback((coordinates: [number, number][]) => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded() || coordinates.length < 2) return;
    const routeData = {
      type: "Feature" as const,
      properties: {},
      geometry: { type: "LineString" as const, coordinates },
    };
    const existingSource = map.getSource(DRIVING_ROUTE_SOURCE_ID) as GeoJSONSource | undefined;
    if (existingSource) {
      existingSource.setData(routeData);
      return;
    }
    map.addSource(DRIVING_ROUTE_SOURCE_ID, { type: "geojson", data: routeData });
    map.addLayer({
      id: DRIVING_ROUTE_CASING_ID,
      type: "line",
      source: DRIVING_ROUTE_SOURCE_ID,
      paint: { "line-color": "#07120f", "line-width": 9, "line-opacity": 0.75 },
      layout: { "line-cap": "round", "line-join": "round" },
    });
    map.addLayer({
      id: DRIVING_ROUTE_LINE_ID,
      type: "line",
      source: DRIVING_ROUTE_SOURCE_ID,
      paint: { "line-color": "#69d2c4", "line-width": 5 },
      layout: { "line-cap": "round", "line-join": "round" },
    });
  }, []);

  const clearDrivingRoute = useCallback(() => {
    const map = mapRef.current;
    if (map?.getLayer(DRIVING_ROUTE_LINE_ID)) map.removeLayer(DRIVING_ROUTE_LINE_ID);
    if (map?.getLayer(DRIVING_ROUTE_CASING_ID)) map.removeLayer(DRIVING_ROUTE_CASING_ID);
    if (map?.getSource(DRIVING_ROUTE_SOURCE_ID)) map.removeSource(DRIVING_ROUTE_SOURCE_ID);
    pendingDirectionsTargetRef.current = null;
    navigationActiveRef.current = false;
    spokenStepIndexRef.current = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setDirectionsTargetId(null);
    setDrivingRoute(null);
    setDirectionsError("");
    setDirectionsLoading(false);
    setNavigationActive(false);
    setNavigationArrived(false);
    setNavigationProgressState(null);
    map?.easeTo({ pitch: 0, bearing: 0, duration: 500 });
  }, []);

  const loadWorkspace = useCallback(async (supabase: SupabaseClient, access: OrganizationAccess) => {
    setGate((current) => current === "ready" ? "ready" : "loading");
    setGateMessage("Loading map layers and assets…");
    const [workspaceResult, fieldsResult, photosResult, eventsResult, tasksResult, incidentsResult, incidentUpdatesResult, connectionsResult, devicesResult, pointConnectionsResult, valveActionsResult, isolationPlansResult] = await Promise.all([
      supabase.rpc("maps_workspace_snapshot", { input_organization_id: access.organizationId }),
      supabase.from("map_layer_fields").select("id, organization_id, layer_id, field_key, label, field_type, options, is_required, sort_order").eq("organization_id", access.organizationId).order("sort_order"),
      supabase.from("map_feature_photos").select("id, organization_id, feature_id, storage_path, caption, mime_type, size_bytes, organization_file_id, created_at").eq("organization_id", access.organizationId).order("created_at", { ascending: false }),
      supabase.from("map_events").select("id, organization_id, feature_id, sequence_number, event_type, title, summary, severity, compliance_basis, occurred_at, discovered_at, resolved_at, details, customer_reference, request_reference, amends_event_id, amendment_kind, amendment_reason, record_hash, submitted_at").eq("organization_id", access.organizationId).order("occurred_at", { ascending: false }),
      supabase.from("map_tasks").select("id, organization_id, feature_id, source_event_id, title, category, description, priority, status, compliance_basis, compliance_source_name, compliance_source_url, due_at, assigned_to_user_id, customer_reference, request_reference, completed_at, completion_event_id, created_at, updated_at").eq("organization_id", access.organizationId).is("archived_at", null).order("due_at"),
      supabase.from("map_incidents").select("id, organization_id, incident_number, incident_type, feature_id, reported_geometry, geometry, snap_distance_m, status, severity, title, initial_report, cause, customers_affected_estimate, repair_method, pressure_lost, disinfected, sample_collected, chlorine_residual, sample_result, customer_reference, request_reference, started_at, resolved_at, closed_event_id, created_at, updated_at").eq("organization_id", access.organizationId).order("started_at", { ascending: false }),
      supabase.from("map_incident_updates").select("id, organization_id, incident_id, update_type, status_after, note, details, occurred_at, created_by_user_id, submitted_at").eq("organization_id", access.organizationId).order("occurred_at"),
      supabase.from("map_network_connections").select("id, organization_id, feature_id, endpoint, connected_feature_id, geometry, connected_fraction, snap_distance_m, created_at").eq("organization_id", access.organizationId),
      supabase.from("map_network_devices").select("id, organization_id, device_feature_id, line_a_feature_id, line_b_feature_id, device_type, geometry, created_at").eq("organization_id", access.organizationId),
      supabase.from("map_point_line_connections").select("id, organization_id, point_feature_id, line_feature_id, connection_type, geometry, line_fraction, distance_m, created_at, updated_at").eq("organization_id", access.organizationId),
      supabase.from("map_incident_valve_actions").select("id, organization_id, incident_id, valve_feature_id, status, note, occurred_at, created_by_user_id, submitted_at").eq("organization_id", access.organizationId).order("occurred_at"),
      supabase.from("map_incident_isolation_plans").select("id, organization_id, incident_id, recommended_valve_ids, isolated_feature_ids, affected_meter_ids, customer_references, affected_meter_count, affected_customer_count, topology_complete, warnings, calculated_at, updated_at").eq("organization_id", access.organizationId),
    ]);
    if (workspaceResult.error || fieldsResult.error || photosResult.error || eventsResult.error || tasksResult.error || incidentsResult.error || incidentUpdatesResult.error || connectionsResult.error || devicesResult.error || pointConnectionsResult.error || valveActionsResult.error || isolationPlansResult.error) {
      throw workspaceResult.error || fieldsResult.error || photosResult.error || eventsResult.error || tasksResult.error || incidentsResult.error || incidentUpdatesResult.error || connectionsResult.error || devicesResult.error || pointConnectionsResult.error || valveActionsResult.error || isolationPlansResult.error;
    }
    const snapshot = workspaceResult.data as unknown as MapWorkspaceSnapshot;
    const nextLayers = Array.isArray(snapshot.layers) ? snapshot.layers : [];
    const nextFeatures = Array.isArray(snapshot.features) ? snapshot.features : [];
    setLayers(nextLayers);
    setFeatures(nextFeatures);
    setLayerFields((fieldsResult.data || []) as MapLayerField[]);
    setFeaturePhotos((photosResult.data || []) as MapFeaturePhoto[]);
    setMapEvents((eventsResult.data || []) as MapEvent[]);
    setMapTasks((tasksResult.data || []) as MapTask[]);
    setMapIncidents((incidentsResult.data || []) as MapIncident[]);
    setMapIncidentUpdates((incidentUpdatesResult.data || []) as MapIncidentUpdate[]);
    setNetworkConnections((connectionsResult.data || []) as MapNetworkConnection[]);
    setNetworkDevices((devicesResult.data || []) as MapNetworkDevice[]);
    setPointLineConnections((pointConnectionsResult.data || []) as MapPointLineConnection[]);
    setIncidentValveActions((valveActionsResult.data || []) as MapIncidentValveAction[]);
    setIncidentIsolationPlans((isolationPlansResult.data || []) as MapIncidentIsolationPlan[]);
    setVisibleLayers(Object.fromEntries(nextLayers.map((layer) => [layer.id, layer.is_visible_by_default])));
    setSelectedLayerId((current) => nextLayers.some((layer) => layer.id === current && layer.is_editable && layer.geometry_type !== "raster")
      ? current
      : nextLayers.find((layer) => layer.is_editable && layer.geometry_type !== "raster")?.id || "");
    setActiveAccess({ ...access, role: snapshot.role || access.role });
    setGate("ready");
  }, []);

  useEffect(() => {
    const config = window.RECORDS_APP_CONFIG || {};
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      setGate("error");
      setGateMessage("N3XRA Maps is not connected to the platform configuration.");
      return;
    }
    const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
    setClient(supabase);
    void (async () => {
      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!sessionData.session?.user) {
          setGate("signed-out");
          setGateMessage("Sign in to open your N3XRA Maps workspace.");
          return;
        }
        const { data, error } = await supabase.rpc("maps_access_list");
        if (error) throw error;
        const available = Array.isArray(data) ? data as OrganizationAccess[] : [];
        setAccessList(available);
        if (!available.length) {
          const { data: request, error: requestError } = await supabase
            .from("maps_access_requests")
            .select("status")
            .eq("user_id", sessionData.session.user.id)
            .maybeSingle();
          if (requestError && requestError.code !== "PGRST116") throw requestError;
          if (request?.status === "approved") {
            const { data: options, error: optionsError } = await supabase.rpc("maps_activation_options");
            if (optionsError) throw optionsError;
            const nextOptions = options as ActivationOptions;
            const eligible = Array.isArray(nextOptions?.organizations) ? nextOptions.organizations : [];
            setActivationOptions({ ...nextOptions, organizations: eligible });
            setActivationOrganizationId(eligible[0]?.id || "");
            setActivationMode(eligible.length ? "existing" : "new");
            setGate("setup");
            setGateMessage("Choose where this blank Maps workspace belongs.");
            return;
          }
          setGate("unassigned");
          setGateMessage(request?.status === "pending"
            ? "Your Maps early-access request is awaiting N3XRA approval."
            : "Request Maps early access from your N3XRA dashboard.");
          return;
        }
        const storedId = window.localStorage.getItem(ACTIVE_ORGANIZATION_KEY);
        const initial = available.find((access) => access.organizationId === storedId) || available[0];
        if (!initial) return;
        await loadWorkspace(supabase, initial);
      } catch (error) {
        console.warn("N3XRA Maps could not open.", error);
        setGate("error");
        setGateMessage("Maps could not be opened. Please refresh and try again.");
      }
    })();
  }, [loadWorkspace]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !mapboxToken) return;
    mapboxgl.accessToken = mapboxToken;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: STANDARD_STYLE,
      center: [-98.5795, 39.8283],
      zoom: 3.2,
      projection: "mercator",
      attributionControl: false,
      logoPosition: "top-right",
    });
    map.addControl(new mapboxgl.AttributionControl(), "top-right");
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "bottom-right");
    map.once("load", () => setMapReady(true));
    mapRef.current = map;
    return () => {
      featureMarkersRef.current.forEach((marker) => marker.remove());
      featureMarkersRef.current.clear();
      incidentMarkersRef.current.forEach((marker) => marker.remove());
      incidentMarkersRef.current.clear();
      shapeVertexMarkersRef.current.forEach((marker) => marker.remove());
      shapeVertexMarkersRef.current = [];
      locationMarkerRef.current?.remove();
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [mapboxToken]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || currentBasemapRef.current === basemap) return;
    currentBasemapRef.current = basemap;
    map.setStyle(
      basemap === "satellite" ? SATELLITE_STYLE : STANDARD_STYLE,
      { diff: false } as Parameters<MapboxMap["setStyle"]>[1],
    );
  }, [basemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !drivingRoute) return;
    const renderRoute = () => drawDrivingRoute(drivingRoute.coordinates);
    if (map.isStyleLoaded()) renderRoute();
    else map.once("style.load", renderRoute);
    return () => {
      map.off("style.load", renderRoute);
    };
  }, [basemap, drawDrivingRoute, drivingRoute]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    featureMarkersRef.current.forEach((marker) => marker.remove());
    featureMarkersRef.current.clear();
    features.forEach((feature) => {
      if (visibleLayers[feature.layer_id] === false) return;
      const coordinates = pointCoordinates(feature);
      if (!coordinates) return;
      const layer = layers.find((item) => item.id === feature.layer_id);
      const button = document.createElement("button");
      button.type = "button";
      const isMoving = movingFeatureId === feature.id;
      const drawingLayer = shapeDraft?.geometryType === "line" ? layers.find((item) => item.id === shapeDraft.layerId) : null;
      const isConnectable = Boolean(drawingLayer && drawingLayer.system_type !== "other" && drawingLayer.system_type !== "reference" && drawingLayer.system_type === layer?.system_type);
      const isIsolationValve = Boolean(selectedIsolationEstimate?.requiredValveIds.includes(feature.id));
      button.className = `maps-marker${selectedFeatureId === feature.id ? " is-selected" : ""}${isMoving ? " is-moving" : ""}${isConnectable ? " is-connectable" : ""}${isIsolationValve ? " is-isolation-valve" : ""}`;
      button.style.setProperty("--marker-color", mapSymbolColor(layer?.icon_key || "marker"));
      const label = document.createElement("span");
      label.innerHTML = mapSymbolMarkup(layer?.icon_key || "marker");
      button.append(label);
      button.setAttribute("aria-label", `Open ${feature.title}`);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        if (connectLineDrawingToAsset(feature)) return;
        setSelectedFeatureId(feature.id);
        setSidebarOpen(false);
      });
      const marker = new mapboxgl.Marker({
        element: button,
        anchor: "center",
        offset: [0, 0],
        draggable: isMoving,
      })
        .setLngLat(coordinates)
        .addTo(map);
      if (isMoving) {
        marker.on("dragend", () => {
          const nextCoordinates = marker.getLngLat();
          setProposedMove({
            longitude: nextCoordinates.lng,
            latitude: nextCoordinates.lat,
            placementMethod: "manual",
            accuracyMeters: null,
          });
        });
      }
      featureMarkersRef.current.set(feature.id, marker);
    });
  }, [connectLineDrawingToAsset, features, layers, movingFeatureId, selectedFeatureId, selectedIsolationEstimate, shapeDraft, visibleLayers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    incidentMarkersRef.current.forEach((marker) => marker.remove());
    incidentMarkersRef.current.clear();
    visibleIncidents.forEach((incident) => {
      const coordinates = geoPointCoordinates(incident.geometry);
      if (!coordinates || visibleLayers[features.find((feature) => feature.id === incident.feature_id)?.layer_id || ""] === false) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `maps-incident-marker is-${incident.severity}${incident.status === "resolved" ? " is-resolved" : ""}${selectedIncidentId === incident.id ? " is-selected" : ""}`;
      button.innerHTML = WATER_BREAK_ICON_MARKUP;
      button.setAttribute("aria-label", `Open ${incident.status === "resolved" ? "past" : "active"} incident ${incident.title}`);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        incident.status === "resolved" ? openHistoricalIncident(incident) : openIncident(incident);
      });
      const marker = new mapboxgl.Marker({ element: button, anchor: "center" }).setLngLat(coordinates).addTo(map);
      incidentMarkersRef.current.set(incident.id, marker);
    });
  }, [features, openHistoricalIncident, openIncident, selectedIncidentId, visibleIncidents, visibleLayers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const data = {
      type: "FeatureCollection" as const,
      features: features.filter((feature) => feature.id !== editingShapeId && (feature.geometry.type === "LineString" || feature.geometry.type === "Polygon"))
        .filter((feature) => visibleLayers[feature.layer_id] !== false)
        .map((feature) => {
          const layer = layers.find((item) => item.id === feature.layer_id);
          return {
            type: "Feature" as const,
            properties: {
              featureId: feature.id,
              color: layer?.color || "#1ed7b2",
              fillColor: layer?.fill_color || layer?.color || "#1ed7b2",
              opacity: layer?.opacity ?? 0.75,
              selected: feature.id === selectedFeatureId,
              activeIncident: activeIncidentFeatureIds.has(feature.id),
              isolatedEstimate: highlightedIsolationFeatureIds.has(feature.id),
              flowDirection: feature.flow_direction || "unknown",
            },
            geometry: feature.geometry,
          };
        }),
    };
    const handleShapeClick = (event: mapboxgl.MapLayerMouseEvent) => {
      if (shapeDraft) return;
      const featureId = (event.features?.[0] as { properties?: { featureId?: unknown } } | undefined)?.properties?.featureId;
      if (typeof featureId === "string") {
        setSelectedFeatureId(featureId);
        setSidebarOpen(false);
      }
    };
    const showPointer = () => { map.getCanvas().style.cursor = "pointer"; };
    const clearPointer = () => { if (!shapeDraft) map.getCanvas().style.cursor = ""; };
    const render = () => {
      if (map.getSource(SAVED_SHAPES_SOURCE_ID)) {
        (map.getSource(SAVED_SHAPES_SOURCE_ID) as GeoJSONSource).setData(data);
      } else {
        map.addSource(SAVED_SHAPES_SOURCE_ID, { type: "geojson", data });
        map.addLayer({
          id: SAVED_SHAPES_FILL_ID,
          type: "fill",
          source: SAVED_SHAPES_SOURCE_ID,
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: {
            "fill-color": ["get", "fillColor"],
            "fill-opacity": ["case", ["get", "selected"], 0.35, ["*", ["get", "opacity"], 0.2]],
          },
        });
        map.addLayer({
          id: SAVED_SHAPES_LINE_ID,
          type: "line",
          source: SAVED_SHAPES_SOURCE_ID,
          paint: {
            "line-color": ["case", ["get", "activeIncident"], "#f05f55", ["get", "isolatedEstimate"], "#f2a444", ["get", "color"]],
            "line-width": ["case", ["get", "selected"], 7, ["get", "activeIncident"], 6, ["get", "isolatedEstimate"], 6, 4],
            "line-opacity": ["case", ["get", "selected"], 1, ["get", "opacity"]],
          },
          layout: { "line-cap": "round", "line-join": "round" },
        });
        map.addLayer({
          id: SAVED_SHAPES_FLOW_ID,
          type: "symbol",
          source: SAVED_SHAPES_SOURCE_ID,
          filter: ["all", ["==", ["geometry-type"], "LineString"], ["!=", ["get", "flowDirection"], "unknown"]],
          layout: {
            "symbol-placement": "line",
            "symbol-spacing": 90,
            "text-field": ["case", ["==", ["get", "flowDirection"], "start_to_end"], "▶", "◀"],
            "text-size": 12,
            "text-rotation-alignment": "map",
            "text-keep-upright": false,
            "text-allow-overlap": false,
          },
          paint: {
            "text-color": ["get", "color"],
            "text-halo-color": "#07120f",
            "text-halo-width": 2,
          },
        });
      }
      map.on("click", SAVED_SHAPES_FILL_ID, handleShapeClick);
      map.on("click", SAVED_SHAPES_LINE_ID, handleShapeClick);
      map.on("mouseenter", SAVED_SHAPES_FILL_ID, showPointer);
      map.on("mouseenter", SAVED_SHAPES_LINE_ID, showPointer);
      map.on("mouseleave", SAVED_SHAPES_FILL_ID, clearPointer);
      map.on("mouseleave", SAVED_SHAPES_LINE_ID, clearPointer);
    };
    if (map.isStyleLoaded()) render();
    else map.once("style.load", render);
    return () => {
      map.off("style.load", render);
      map.off("click", SAVED_SHAPES_FILL_ID, handleShapeClick);
      map.off("mouseenter", SAVED_SHAPES_FILL_ID, showPointer);
      map.off("mouseleave", SAVED_SHAPES_FILL_ID, clearPointer);
      map.off("click", SAVED_SHAPES_LINE_ID, handleShapeClick);
      map.off("mouseenter", SAVED_SHAPES_LINE_ID, showPointer);
      map.off("mouseleave", SAVED_SHAPES_LINE_ID, clearPointer);
    };
  }, [activeIncidentFeatureIds, basemap, editingShapeId, features, highlightedIsolationFeatureIds, layers, mapReady, selectedFeatureId, shapeDraft, visibleLayers]);

  useEffect(() => {
    const map = mapRef.current;
    const draft = shapeDraft || pendingShape;
    if (!map || !mapReady || !draft) return;
    const layer = layers.find((item) => item.id === draft.layerId);
    const previewCoordinates = shapeDraft && shapeHoverCoordinate ? [...draft.coordinates, shapeHoverCoordinate] : draft.coordinates;
    const drawableShape = draft.geometryType === "line" ? previewCoordinates.length >= 2 : draft.coordinates.length >= 3;
    const previewGeometry: MapFeature["geometry"] | null = drawableShape
      ? shapeGeometry({ ...draft, coordinates: previewCoordinates })
      : previewCoordinates.length >= 2
        ? { type: "LineString", coordinates: previewCoordinates }
        : null;
    const data = {
      type: "FeatureCollection" as const,
      features: [
        ...(previewGeometry ? [{ type: "Feature" as const, properties: { kind: "shape" }, geometry: previewGeometry }] : []),
        ...(draft.coordinates.length ? [{ type: "Feature" as const, properties: { kind: "vertices" }, geometry: { type: "MultiPoint" as const, coordinates: draft.coordinates } }] : []),
        ...(shapeDraft?.geometryType === "line" && shapeSnapTarget ? [{ type: "Feature" as const, properties: { kind: "snap" }, geometry: { type: "Point" as const, coordinates: shapeSnapTarget.coordinate } }] : []),
      ],
    };
    const render = () => {
      const existing = map.getSource(DRAFT_SHAPE_SOURCE_ID) as GeoJSONSource | undefined;
      if (existing) {
        existing.setData(data);
        return;
      }
      map.addSource(DRAFT_SHAPE_SOURCE_ID, { type: "geojson", data });
      map.addLayer({ id: DRAFT_SHAPE_FILL_ID, type: "fill", source: DRAFT_SHAPE_SOURCE_ID, filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": layer?.fill_color || layer?.color || "#1ed7b2", "fill-opacity": 0.28 } });
      map.addLayer({ id: DRAFT_SHAPE_CASING_ID, type: "line", source: DRAFT_SHAPE_SOURCE_ID, filter: ["==", ["get", "kind"], "shape"], paint: { "line-color": "#07120f", "line-width": 9, "line-opacity": 0.82 }, layout: { "line-cap": "round", "line-join": "round" } });
      map.addLayer({ id: DRAFT_SHAPE_LINE_ID, type: "line", source: DRAFT_SHAPE_SOURCE_ID, filter: ["==", ["get", "kind"], "shape"], paint: { "line-color": layer?.color || "#1ed7b2", "line-width": 5, "line-opacity": 1 }, layout: { "line-cap": "round", "line-join": "round" } });
      map.addLayer({ id: DRAFT_SHAPE_VERTICES_ID, type: "circle", source: DRAFT_SHAPE_SOURCE_ID, filter: ["==", ["get", "kind"], "vertices"], paint: { "circle-radius": 6, "circle-color": "#f5a23c", "circle-stroke-color": "#08131d", "circle-stroke-width": 2 } });
      map.addLayer({ id: DRAFT_SHAPE_SNAP_ID, type: "circle", source: DRAFT_SHAPE_SOURCE_ID, filter: ["==", ["get", "kind"], "snap"], paint: { "circle-radius": 10, "circle-color": "rgba(105,210,196,0.2)", "circle-stroke-color": "#69d2c4", "circle-stroke-width": 3 } });
    };
    if (map.isStyleLoaded()) render();
    else map.once("style.load", render);
    return () => {
      map.off("style.load", render);
    };
  }, [basemap, layers, mapReady, pendingShape, shapeDraft, shapeHoverCoordinate, shapeSnapTarget]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || shapeDraft || pendingShape) return;
    if (map.getLayer(DRAFT_SHAPE_SNAP_ID)) map.removeLayer(DRAFT_SHAPE_SNAP_ID);
    if (map.getLayer(DRAFT_SHAPE_VERTICES_ID)) map.removeLayer(DRAFT_SHAPE_VERTICES_ID);
    if (map.getLayer(DRAFT_SHAPE_LINE_ID)) map.removeLayer(DRAFT_SHAPE_LINE_ID);
    if (map.getLayer(DRAFT_SHAPE_CASING_ID)) map.removeLayer(DRAFT_SHAPE_CASING_ID);
    if (map.getLayer(DRAFT_SHAPE_FILL_ID)) map.removeLayer(DRAFT_SHAPE_FILL_ID);
    if (map.getSource(DRAFT_SHAPE_SOURCE_ID)) map.removeSource(DRAFT_SHAPE_SOURCE_ID);
  }, [pendingShape, shapeDraft]);

  useEffect(() => {
    const map = mapRef.current;
    shapeVertexMarkersRef.current.forEach((marker) => marker.remove());
    shapeVertexMarkersRef.current = [];
    if (!map || !editingShapeId || !shapeDraft) return;
    const markers = shapeDraft.coordinates.map((coordinate, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `maps-shape-vertex${selectedShapeVertexIndex === index ? " is-selected" : ""}`;
      button.setAttribute("aria-label", `Shape point ${index + 1}`);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        setSelectedShapeVertexIndex(index);
      });
      const marker = new mapboxgl.Marker({ element: button, draggable: true })
        .setLngLat(coordinate)
        .addTo(map);
      marker.on("dragstart", () => {
        setShapeEditHistory((history) => [...history, shapeDraft.coordinates]);
      });
      marker.on("dragend", () => {
        const next = marker.getLngLat();
        const proposed: [number, number] = [next.lng, next.lat];
        const snap = shapeDraft.geometryType === "line"
          ? nearestLineSnap(map, proposed, features, layers, shapeDraft.layerId, editingShapeId)
          : null;
        const finalCoordinate = snap?.coordinate || proposed;
        marker.setLngLat(finalCoordinate);
        setShapeSnapTarget(snap);
        setShapeDraft((current) => current ? {
          ...current,
          coordinates: current.coordinates.map((item, itemIndex) => itemIndex === index ? finalCoordinate : item),
        } : current);
      });
      return marker;
    });
    shapeVertexMarkersRef.current = markers;
    return () => {
      markers.forEach((marker) => marker.remove());
      if (shapeVertexMarkersRef.current === markers) shapeVertexMarkersRef.current = [];
    };
  }, [editingShapeId, features, layers, selectedShapeVertexIndex, shapeDraft]);

  useEffect(() => {
    const map = mapRef.current;
    const organizationId = activeAccess?.organizationId;
    if (!map || !mapReady || !organizationId || fittedOrganizationRef.current === organizationId) return;
    const coordinates = features.flatMap((feature) => geometryCoordinates(feature.geometry));
    fittedOrganizationRef.current = organizationId;
    if (!coordinates.length) return;
    if (coordinates.length === 1) {
      map.easeTo({ center: coordinates[0]!, zoom: 17, duration: 650 });
      return;
    }
    const firstPoint = coordinates[0]!;
    const bounds = coordinates.reduce(
      (currentBounds, point) => currentBounds.extend(point),
      new mapboxgl.LngLatBounds(firstPoint, firstPoint),
    );
    map.fitBounds(bounds, { padding: 80, maxZoom: 17, duration: 650 });
  }, [activeAccess?.organizationId, features, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedFeature) return;
    const coordinates = geometryCoordinates(selectedFeature.geometry);
    if (!coordinates.length) return;
    if (coordinates.length === 1) {
      map.easeTo({ center: coordinates[0]!, zoom: Math.max(map.getZoom(), 17), duration: 650 });
      return;
    }
    const bounds = coordinates.slice(1).reduce(
      (currentBounds, coordinate) => currentBounds.extend(coordinate),
      new mapboxgl.LngLatBounds(coordinates[0]!, coordinates[0]!),
    );
    map.fitBounds(bounds, { padding: 100, maxZoom: 18, duration: 650 });
  }, [selectedFeature]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedIncident) return;
    const coordinates = geoPointCoordinates(selectedIncident.geometry);
    if (!coordinates) return;
    map.easeTo({ center: coordinates, zoom: Math.max(map.getZoom(), 17), duration: 650 });
  }, [selectedIncident]);

  useEffect(() => {
    if (!client || !selectedFeatureId) {
      setPhotoUrls({});
      return;
    }
    const photos = featurePhotos.filter((photo) => photo.feature_id === selectedFeatureId);
    if (!photos.length) {
      setPhotoUrls({});
      return;
    }
    let active = true;
    void Promise.all(photos.map(async (photo) => {
      const { data } = await client.storage.from(MAPS_PHOTO_BUCKET).createSignedUrl(photo.storage_path, 3_600);
      return [photo.id, data?.signedUrl || ""] as const;
    })).then((entries) => {
      if (active) setPhotoUrls(Object.fromEntries(entries.filter((entry) => entry[1])));
    });
    return () => {
      active = false;
    };
  }, [client, featurePhotos, selectedFeatureId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !placementMode) return;
    const handleClick = (event: mapboxgl.MapMouseEvent) => {
      setPendingPoint({
        longitude: event.lngLat.lng,
        latitude: event.lngLat.lat,
        placementMethod: "manual",
        accuracyMeters: null,
      });
      setFeatureDialogOpen(true);
      setPlacementMode(false);
    };
    map.getCanvas().style.cursor = "crosshair";
    map.once("click", handleClick);
    return () => {
      map.off("click", handleClick);
      map.getCanvas().style.cursor = "";
    };
  }, [placementMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !breakPlacementFeatureId) return;
    const handleBreakClick = (event: mapboxgl.MapMouseEvent) => {
      setPendingBreakLocation({
        featureId: breakPlacementFeatureId,
        longitude: event.lngLat.lng,
        latitude: event.lngLat.lat,
      });
      setBreakPlacementFeatureId(null);
      setBreakStartDialogOpen(true);
    };
    map.getCanvas().style.cursor = "crosshair";
    map.once("click", handleBreakClick);
    return () => {
      map.off("click", handleBreakClick);
      map.getCanvas().style.cursor = "";
    };
  }, [breakPlacementFeatureId]);

  useEffect(() => {
    const map = mapRef.current;
    const line = features.find((feature) => feature.id === valvePlacementFeatureId);
    if (!map || !line) return;
    const handleValveClick = (event: mapboxgl.MapMouseEvent) => {
      const nearest = nearestPointOnFeatureLine(map, [event.lngLat.lng, event.lngLat.lat], line);
      if (!nearest || nearest.pixelDistance > 28) {
        showToast("Click directly on the selected water line");
        return;
      }
      setPendingValveLocation({
        featureId: line.id,
        longitude: nearest.coordinate[0],
        latitude: nearest.coordinate[1],
      });
      setValvePlacementFeatureId(null);
      setValveDialogOpen(true);
    };
    map.getCanvas().style.cursor = "crosshair";
    map.on("click", handleValveClick);
    return () => {
      map.off("click", handleValveClick);
      map.getCanvas().style.cursor = "";
    };
  }, [features, showToast, valvePlacementFeatureId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !shapeDraft) return;
    const handleShapeMove = (event: mapboxgl.MapMouseEvent) => {
      const proposed: [number, number] = [event.lngLat.lng, event.lngLat.lat];
      const snap = shapeDraft.geometryType === "line"
        ? nearestLineSnap(map, proposed, features, layers, shapeDraft.layerId, editingShapeId)
        : null;
      setShapeSnapTarget(snap);
      setShapeHoverCoordinate(snap?.coordinate || proposed);
    };
    const handleShapeLeave = () => {
      setShapeHoverCoordinate(null);
      setShapeSnapTarget(null);
    };
    const handleShapeClick = (event: mapboxgl.MapMouseEvent) => {
      setShapeHoverCoordinate(null);
      setShapeDraft((current) => current ? {
        ...current,
        coordinates: (() => {
          if (editingShapeId) setShapeEditHistory((history) => [...history, current.coordinates]);
          const proposed: [number, number] = [event.lngLat.lng, event.lngLat.lat];
          const snap = current.geometryType === "line"
            ? nearestLineSnap(map, proposed, features, layers, current.layerId, editingShapeId)
            : null;
          const next = [...current.coordinates, snap?.coordinate || proposed];
          setShapeSnapTarget(snap);
          if (editingShapeId) setSelectedShapeVertexIndex(next.length - 1);
          return next;
        })(),
      } : current);
    };
    map.getCanvas().style.cursor = "crosshair";
    map.on("click", handleShapeClick);
    map.on("mousemove", handleShapeMove);
    map.getCanvas().addEventListener("mouseleave", handleShapeLeave);
    return () => {
      map.off("click", handleShapeClick);
      map.off("mousemove", handleShapeMove);
      map.getCanvas().removeEventListener("mouseleave", handleShapeLeave);
      map.getCanvas().style.cursor = "";
      setShapeHoverCoordinate(null);
      setShapeSnapTarget(null);
    };
  }, [editingShapeId, features, layers, shapeDraft?.layerId, shapeDraft?.geometryType]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !movingFeatureId || proposedMove) return;
    const handleMoveClick = (event: mapboxgl.MapMouseEvent) => {
      const point: PointCoordinates = {
        longitude: event.lngLat.lng,
        latitude: event.lngLat.lat,
        placementMethod: "manual",
        accuracyMeters: null,
      };
      featureMarkersRef.current.get(movingFeatureId)?.setLngLat([point.longitude, point.latitude]);
      setProposedMove(point);
    };
    map.getCanvas().style.cursor = "crosshair";
    map.on("click", handleMoveClick);
    return () => {
      map.off("click", handleMoveClick);
      map.getCanvas().style.cursor = "";
    };
  }, [movingFeatureId, proposedMove]);

  useEffect(() => () => {
    if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    if (locationRequestTimerRef.current !== null) window.clearTimeout(locationRequestTimerRef.current);
  }, []);

  const chooseOrganization = async (organizationId: string) => {
    const access = accessList.find((item) => item.organizationId === organizationId);
    if (!client || !access) return;
    window.localStorage.setItem(ACTIVE_ORGANIZATION_KEY, organizationId);
    fittedOrganizationRef.current = null;
    setSelectedFeatureId(null);
    setShapeDraft(null);
    setPendingShape(null);
    setEditingShapeId(null);
    setShapeEditReview(false);
    setTeamOpen(false);
    setTeamSnapshot(null);
    try {
      await loadWorkspace(client, access);
    } catch (error) {
      console.warn("The selected maps workspace could not be loaded.", error);
      setGate("error");
      setGateMessage("That maps workspace could not be loaded.");
    }
  };

  const loadTeamAccess = async () => {
    if (!client || !activeAccess || !canManageLayers) return;
    setTeamLoading(true);
    const { data, error } = await client.rpc("maps_team_snapshot", { input_organization_id: activeAccess.organizationId });
    setTeamLoading(false);
    if (error) {
      showToast(error.message || "Team access could not be loaded.");
      return;
    }
    setTeamSnapshot(data as MapsTeamSnapshot);
  };

  const openTeamAccess = () => {
    setTeamOpen(true);
    void loadTeamAccess();
  };

  const updateTeamMemberRole = async (member: MapsTeamMember, role: MapsTeamMember["mapsRole"]) => {
    if (!client || !activeAccess || !canManageLayers || member.isOwner || member.userId === teamSnapshot?.currentUserId) return;
    setTeamSavingUserId(member.userId);
    const { error } = await client.rpc("maps_set_member_role", {
      input_organization_id: activeAccess.organizationId,
      input_user_id: member.userId,
      input_role: role,
    });
    setTeamSavingUserId(null);
    if (error) {
      showToast(error.message || "Maps access could not be updated.");
      await loadTeamAccess();
      return;
    }
    await loadTeamAccess();
    showToast(`${member.fullName}'s Maps access is now ${mapsRoleLabel(role).toLowerCase()}.`);
  };

  const activateWorkspace = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || activating) return;
    if (activationMode === "existing" && !activationOrganizationId) {
      setGateMessage("Choose an organization for Maps.");
      return;
    }
    if (activationMode === "new" && !newOrganizationName.trim()) {
      setGateMessage("Enter a name for the new organization.");
      return;
    }

    setActivating(true);
    setGateMessage("Creating your blank Maps workspace…");
    try {
      const { data, error } = await client.rpc("activate_maps_workspace", {
        input_organization_id: activationMode === "existing" ? activationOrganizationId : null,
        input_organization_name: activationMode === "new" ? newOrganizationName.trim() : null,
      });
      if (error) throw error;
      const organizationId = String(data?.organizationId || "");
      const { data: accessData, error: accessError } = await client.rpc("maps_access_list");
      if (accessError) throw accessError;
      const available = Array.isArray(accessData) ? accessData as OrganizationAccess[] : [];
      const access = available.find((item) => item.organizationId === organizationId) || available[0];
      if (!access) throw new Error("Maps access was created, but the workspace could not be opened.");
      setAccessList(available);
      window.localStorage.setItem(ACTIVE_ORGANIZATION_KEY, access.organizationId);
      await loadWorkspace(client, access);
      showToast(`Maps is connected to ${access.organizationName}.`);
    } catch (error) {
      console.warn("Maps workspace activation failed.", error);
      setGate("setup");
      setGateMessage(error instanceof Error ? error.message : "Maps could not be activated.");
    } finally {
      setActivating(false);
    }
  };

  const centerOnLocation = useCallback((location: DeviceLocation) => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({
      center: [location.longitude, location.latitude],
      zoom: Math.max(map.getZoom(), 17),
      duration: 850,
    });
  }, []);

  const applyPosition = useCallback((position: GeolocationPosition, shouldCenter: boolean) => {
    const nextLocation: DeviceLocation = {
      longitude: position.coords.longitude,
      latitude: position.coords.latitude,
      accuracyMeters: position.coords.accuracy,
    };
    setDeviceLocation(nextLocation);
    setNavigationHeading(typeof position.coords.heading === "number" && Number.isFinite(position.coords.heading) ? position.coords.heading : null);
    setNavigationSpeedMps(typeof position.coords.speed === "number" && Number.isFinite(position.coords.speed) ? position.coords.speed : null);
    const map = mapRef.current;
    if (map) {
      const coordinates: [number, number] = [nextLocation.longitude, nextLocation.latitude];
      if (!locationMarkerRef.current) {
        const element = document.createElement("div");
        element.className = "maps-user-location";
        locationMarkerRef.current = new mapboxgl.Marker({ element })
          .setLngLat(coordinates)
          .addTo(map);
      } else {
        locationMarkerRef.current.setLngLat(coordinates);
      }
      const locationElement = locationMarkerRef.current.getElement();
      if (typeof position.coords.heading === "number" && Number.isFinite(position.coords.heading)) {
        locationElement.classList.add("has-heading");
        locationElement.style.setProperty("--user-heading", `${position.coords.heading}deg`);
      } else {
        locationElement.classList.remove("has-heading");
      }
    }
    if (shouldCenter) centerOnLocation(nextLocation);
  }, [centerOnLocation]);

  const locationErrorMessage = (error: GeolocationPositionError) => {
    if (error.code === error.PERMISSION_DENIED) {
      return "Location is blocked for this site. Allow Location in your browser settings, then try again.";
    }
    if (error.code === error.POSITION_UNAVAILABLE) {
      return "Your device could not determine its location. Turn on Location Services, then try again.";
    }
    return "Your location took too long to respond. Check Location Services and try again.";
  };

  const stopLocating = (message = "Location search canceled. You can try again whenever you are ready.") => {
    locationRequestIdRef.current += 1;
    if (locationRequestTimerRef.current !== null) window.clearTimeout(locationRequestTimerRef.current);
    locationRequestTimerRef.current = null;
    if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = null;
    setLocating(false);
    setLocationError(message);
  };

  const startLocating = () => {
    if (!navigator.geolocation) {
      setLocationError("Location is not available on this device.");
      return;
    }
    if (!window.isSecureContext) {
      setLocationError("Location requires a secure connection. Open the published https:// version of N3XRA Maps.");
      return;
    }
    if (deviceLocation) {
      centerOnLocation(deviceLocation);
      setLocationError("");
      return;
    }

    setLocating(true);
    setLocationError("Waiting for your device. If your browser asks to use your location, choose Allow.");
    if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = null;
    if (locationRequestTimerRef.current !== null) window.clearTimeout(locationRequestTimerRef.current);
    const requestId = locationRequestIdRef.current + 1;
    locationRequestIdRef.current = requestId;

    const beginWatch = () => {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (position) => {
          if (requestId === locationRequestIdRef.current) applyPosition(position, false);
        },
        (error) => setLocationError(locationErrorMessage(error)),
        { enableHighAccuracy: true, maximumAge: 2_000, timeout: 20_000 },
      );
    };
    const finish = (position: GeolocationPosition) => {
      if (requestId !== locationRequestIdRef.current) return;
      if (locationRequestTimerRef.current !== null) window.clearTimeout(locationRequestTimerRef.current);
      locationRequestTimerRef.current = null;
      applyPosition(position, true);
      setLocating(false);
      setLocationError("");
      beginWatch();
    };
    const fail = (error: GeolocationPositionError, allowFallback: boolean) => {
      if (requestId !== locationRequestIdRef.current) return;
      if (allowFallback && error.code !== error.PERMISSION_DENIED) {
        navigator.geolocation.getCurrentPosition(
          finish,
          (fallbackError) => {
            if (requestId !== locationRequestIdRef.current) return;
            if (locationRequestTimerRef.current !== null) window.clearTimeout(locationRequestTimerRef.current);
            locationRequestTimerRef.current = null;
            setLocating(false);
            setLocationError(locationErrorMessage(fallbackError));
          },
          { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
        );
        return;
      }
      if (locationRequestTimerRef.current !== null) window.clearTimeout(locationRequestTimerRef.current);
      locationRequestTimerRef.current = null;
      setLocating(false);
      setLocationError(locationErrorMessage(error));
    };

    locationRequestTimerRef.current = window.setTimeout(() => {
      if (requestId !== locationRequestIdRef.current) return;
      locationRequestTimerRef.current = null;
      locationRequestIdRef.current += 1;
      setLocating(false);
      setLocationError("Your browser is still waiting for location access. Allow Location for n3xra.com in your browser settings, then try again.");
    }, 20_000);

    navigator.geolocation.getCurrentPosition(
      finish,
      (error) => fail(error, true),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 },
    );
  };

  const requestDrivingRoute = useCallback(async (targetId: string, origin: DeviceLocation) => {
    const target = features.find((feature) => feature.id === targetId);
    const destination = target ? pointCoordinates(target) : null;
    if (!target || !destination || !mapboxToken) {
      setDirectionsError("Directions are not available for this mapped item.");
      return;
    }
    setDirectionsTargetId(target.id);
    const currentMap = mapRef.current;
    if (!navigationActiveRef.current) {
      if (currentMap?.getLayer(DRIVING_ROUTE_LINE_ID)) currentMap.removeLayer(DRIVING_ROUTE_LINE_ID);
      if (currentMap?.getLayer(DRIVING_ROUTE_CASING_ID)) currentMap.removeLayer(DRIVING_ROUTE_CASING_ID);
      if (currentMap?.getSource(DRIVING_ROUTE_SOURCE_ID)) currentMap.removeSource(DRIVING_ROUTE_SOURCE_ID);
      setDrivingRoute(null);
    }
    lastRerouteAtRef.current = Date.now();
    setDirectionsLoading(true);
    setDirectionsError("");
    try {
      const coordinates = `${origin.longitude},${origin.latitude};${destination[0]},${destination[1]}`;
      const parameters = new URLSearchParams({
        alternatives: "false",
        geometries: "geojson",
        overview: "full",
        steps: "true",
        voice_instructions: "true",
        banner_instructions: "true",
        voice_units: "imperial",
        language: "en",
        access_token: mapboxToken,
      });
      const response = await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coordinates}?${parameters}`);
      const result = await response.json() as {
        code?: string;
        message?: string;
        routes?: Array<{
          distance: number;
          duration: number;
          geometry: { coordinates: [number, number][] };
          legs: Array<{ steps: Array<{
            distance: number;
            name?: string;
            maneuver?: { instruction?: string };
            geometry?: { coordinates?: [number, number][] };
            voiceInstructions?: Array<{ announcement?: string }>;
          }> }>;
        }>;
      };
      const route = result.routes?.[0];
      if (!response.ok || result.code !== "Ok" || !route?.geometry?.coordinates?.length) {
        throw new Error(result.message || "No driving route could be found.");
      }
      const nextRoute: DrivingRoute = {
        distanceMeters: route.distance,
        durationSeconds: route.duration,
        coordinates: route.geometry.coordinates,
        steps: route.legs.flatMap((leg) => leg.steps.map((step) => ({
          instruction: step.maneuver?.instruction || step.name || "Continue",
          roadName: step.name || "",
          distanceMeters: step.distance,
          coordinates: step.geometry?.coordinates || [],
          voiceAnnouncements: (step.voiceInstructions || []).map((instruction) => instruction.announcement || "").filter(Boolean),
        }))),
      };
      setDrivingRoute(nextRoute);
      if (navigationActiveRef.current) spokenStepIndexRef.current = null;
      drawDrivingRoute(nextRoute.coordinates);
      const map = mapRef.current;
      if (map && !navigationActiveRef.current) {
        const first = nextRoute.coordinates[0]!;
        const bounds = nextRoute.coordinates.reduce(
          (currentBounds, coordinate) => currentBounds.extend(coordinate),
          new mapboxgl.LngLatBounds(first, first),
        );
        map.fitBounds(bounds, {
          padding: window.innerWidth <= 860
            ? { top: 90, right: 35, bottom: 300, left: 35 }
            : { top: 90, right: 90, bottom: 90, left: 420 },
          maxZoom: 17,
          duration: 850,
        });
      }
    } catch (error) {
      console.warn("Driving directions could not be loaded.", error);
      if (!navigationActiveRef.current) setDrivingRoute(null);
      setDirectionsError(error instanceof Error ? error.message : "Driving directions could not be loaded.");
    } finally {
      setDirectionsLoading(false);
    }
  }, [drawDrivingRoute, features, mapboxToken]);

  const startDirections = (feature: MapFeature) => {
    if (feature.geometry.type !== "Point") {
      setDirectionsError("Directions are only available for point locations right now.");
      return;
    }
    setDirectionsTargetId(feature.id);
    if (deviceLocation) {
      void requestDrivingRoute(feature.id, deviceLocation);
      return;
    }
    pendingDirectionsTargetRef.current = feature.id;
    setDirectionsError("Finding your location before building the route…");
    startLocating();
  };

  useEffect(() => {
    const targetId = pendingDirectionsTargetRef.current;
    if (!targetId || !deviceLocation) return;
    pendingDirectionsTargetRef.current = null;
    void requestDrivingRoute(targetId, deviceLocation);
  }, [deviceLocation, requestDrivingRoute]);

  const speakNavigationInstruction = useCallback((message: string) => {
    if (!voiceGuidance || !("speechSynthesis" in window) || !message) return;
    window.speechSynthesis.cancel();
    const instruction = new SpeechSynthesisUtterance(message);
    instruction.rate = 1;
    instruction.lang = "en-US";
    window.speechSynthesis.speak(instruction);
  }, [voiceGuidance]);

  const startLiveNavigation = () => {
    if (!drivingRoute || !deviceLocation || !directionsTarget) return;
    navigationActiveRef.current = true;
    lastRerouteAtRef.current = Date.now();
    spokenStepIndexRef.current = null;
    setNavigationActive(true);
    setNavigationArrived(false);
    setDirectionsError("");
    if (watchIdRef.current === null && navigator.geolocation) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (position) => applyPosition(position, false),
        (error) => setLocationError(locationErrorMessage(error)),
        { enableHighAccuracy: true, maximumAge: 1_000, timeout: 20_000 },
      );
    }
    speakNavigationInstruction(`Navigation started to ${directionsTarget.title}.`);
  };

  const stopLiveNavigation = () => {
    navigationActiveRef.current = false;
    spokenStepIndexRef.current = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setNavigationActive(false);
    setNavigationArrived(false);
    setNavigationProgressState(null);
    mapRef.current?.easeTo({ pitch: 0, bearing: 0, duration: 500 });
  };

  const toggleVoiceGuidance = () => {
    setVoiceGuidance((current) => {
      if (current && "speechSynthesis" in window) window.speechSynthesis.cancel();
      return !current;
    });
  };

  useEffect(() => {
    if (!navigationActive || !drivingRoute || !deviceLocation || !directionsTarget) return;
    const progress = navigationProgress(drivingRoute, deviceLocation);
    setNavigationProgressState(progress);

    const destination = pointCoordinates(directionsTarget);
    const distanceToDestination = destination
      ? coordinateDistanceMeters([deviceLocation.longitude, deviceLocation.latitude], destination)
      : Number.POSITIVE_INFINITY;
    const arrived = deviceLocation.accuracyMeters <= 75
      && distanceToDestination <= Math.max(20, deviceLocation.accuracyMeters);
    setNavigationArrived(arrived);

    const map = mapRef.current;
    if (map) {
      map.easeTo({
        center: [deviceLocation.longitude, deviceLocation.latitude],
        zoom: Math.max(map.getZoom(), 16.5),
        bearing: navigationHeading ?? map.getBearing(),
        pitch: 48,
        duration: 650,
      });
    }

    if (arrived) {
      if (spokenStepIndexRef.current !== -1) {
        spokenStepIndexRef.current = -1;
        speakNavigationInstruction(`You have arrived at ${directionsTarget.title}.`);
      }
      return;
    }

    if (spokenStepIndexRef.current !== progress.stepIndex) {
      spokenStepIndexRef.current = progress.stepIndex;
      const step = drivingRoute.steps[progress.stepIndex];
      speakNavigationInstruction(step?.voiceAnnouncements[0] || step?.instruction || "Continue on the route.");
    }

    const now = Date.now();
    const offRouteThreshold = Math.max(60, deviceLocation.accuracyMeters * 1.5);
    const needsReroute = progress.offRouteMeters > offRouteThreshold;
    const needsTrafficRefresh = now - lastRerouteAtRef.current >= 60_000;
    if (!directionsLoading && now - lastRerouteAtRef.current >= 15_000 && (needsReroute || needsTrafficRefresh)) {
      if (needsReroute) setDirectionsError("You left the route. Finding a new one…");
      void requestDrivingRoute(directionsTarget.id, deviceLocation);
    }
  }, [deviceLocation, directionsLoading, directionsTarget, drivingRoute, navigationActive, navigationHeading, requestDrivingRoute, speakNavigationInstruction]);

  const placeAtCurrentLocation = () => {
    if (!deviceLocation) {
      if (!locating) startLocating();
      showToast("Waiting for a precise device location…");
      return;
    }
    setPendingPoint({
      longitude: deviceLocation.longitude,
      latitude: deviceLocation.latitude,
      placementMethod: "device_gps",
      accuracyMeters: deviceLocation.accuracyMeters,
    });
    setFeatureDialogOpen(true);
  };

  const saveLayer = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || !activeAccess || !canManageLayers) return;
    const name = newLayerDraft.name.trim();
    const geometryType = newLayerDraft.geometryType;
    const layerColor = geometryType === "point" ? mapSymbolColor(newLayerDraft.iconKey) : newLayerDraft.color;
    if (!name) return;
    setSaving(true);
    const { data: createdLayer, error } = await client.from("map_layers").insert({
      organization_id: activeAccess.organizationId,
      name,
      description: newLayerDraft.description.trim() || null,
      geometry_type: geometryType,
      feature_kind: geometryType === "raster" || newLayerDraft.systemType === "reference" ? "reference" : "asset",
      standard_key: newLayerDraft.presetKey || null,
      system_type: newLayerDraft.systemType,
      icon_key: geometryType === "point" ? newLayerDraft.iconKey : "marker",
      color: layerColor,
      fill_color: layerColor,
      is_editable: true,
    }).select("id").single();
    const preset = STANDARD_LAYER_PRESETS.find((item) => item.key === newLayerDraft.presetKey);
    const { error: fieldError } = !error && createdLayer && preset?.fields.length
      ? await client.from("map_layer_fields").insert(preset.fields.map((field, index) => ({
        organization_id: activeAccess.organizationId,
        layer_id: createdLayer.id,
        field_key: fieldKeyFromLabel(field.label, `field_${index + 1}`),
        label: field.label,
        field_type: field.fieldType,
        options: field.options || [],
        is_required: false,
        sort_order: (index + 1) * 10,
      })))
      : { error: null };
    setSaving(false);
    if (error || fieldError) {
      showToast(error?.message || fieldError?.message || "That layer could not be created.");
      return;
    }
    setLayerDialogOpen(false);
    setNewLayerDraft({ presetKey: "", name: "", description: "", geometryType: "point", iconKey: "marker", color: mapSymbolColor("marker"), systemType: "other" });
    await loadWorkspace(client, activeAccess);
    showToast(preset ? `${preset.name} created from the N3XRA standard` : "Layer created");
  };

  const savePoint = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || !activeAccess || !pendingPoint || !selectedLayerId || !canEdit) return;
    const form = new FormData(event.currentTarget);
    const fields = layerFields.filter((field) => field.layer_id === selectedLayerId);
    setSaving(true);
    const { data, error } = await client.rpc("create_map_point", {
      input_organization_id: activeAccess.organizationId,
      input_layer_id: selectedLayerId,
      input_title: String(form.get("title") || "").trim(),
      input_reference_code: String(form.get("reference_code") || "").trim() || null,
      input_description: String(form.get("description") || "").trim() || null,
      input_longitude: pendingPoint.longitude,
      input_latitude: pendingPoint.latitude,
      input_accuracy_m: pendingPoint.accuracyMeters,
      input_placement_method: pendingPoint.placementMethod,
    });
    if (error) {
      setSaving(false);
      showToast(error.message);
      return;
    }
    const featureId = String(data || "");
    const detailResult = await client.from("map_features").update({
      address: String(form.get("address") || "").trim() || null,
      customer_reference: String(form.get("customer_reference") || "").trim() || null,
      properties: readCustomProperties(form, fields),
    }).eq("id", featureId).eq("organization_id", activeAccess.organizationId).select("id").single();
    const connectionResult = connectNewPoint && pendingPointConnectionCandidate
      ? await client.rpc("maps_connect_point_to_line", {
        input_organization_id: activeAccess.organizationId,
        input_point_feature_id: featureId,
        input_line_feature_id: pendingPointConnectionCandidate.featureId,
      })
      : { error: null };
    setSaving(false);
    if (detailResult.error) {
      showToast(`Location saved, but its asset details need attention: ${detailResult.error.message}`);
    } else if (connectionResult.error) {
      showToast(`Location saved, but its line connection needs attention: ${connectionResult.error.message}`);
    }
    setFeatureDialogOpen(false);
    setPendingPoint(null);
    setConnectNewPoint(false);
    await loadWorkspace(client, activeAccess);
    setSelectedFeatureId(featureId);
    if (!detailResult.error && !connectionResult.error) showToast(connectNewPoint && pendingPointConnectionCandidate ? "Location saved and connected" : "Location saved");
  };

  const saveShape = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || !activeAccess || !pendingShape || !canEdit) return;
    const form = new FormData(event.currentTarget);
    const fields = layerFields.filter((field) => field.layer_id === pendingShape.layerId);
    setSaving(true);
    const { data, error } = await client.rpc("create_map_shape", {
      input_organization_id: activeAccess.organizationId,
      input_layer_id: pendingShape.layerId,
      input_title: String(form.get("title") || "").trim(),
      input_reference_code: String(form.get("reference_code") || "").trim() || null,
      input_description: String(form.get("description") || "").trim() || null,
      input_geometry: shapeGeometry(pendingShape),
    });
    if (error) {
      setSaving(false);
      showToast(error.message);
      return;
    }
    const featureId = String(data || "");
    const detailResult = await client.from("map_features").update({
      address: String(form.get("address") || "").trim() || null,
      customer_reference: String(form.get("customer_reference") || "").trim() || null,
      properties: readCustomProperties(form, fields),
    }).eq("id", featureId).eq("organization_id", activeAccess.organizationId).select("id").single();
    const assetConnectionResults = pendingShape.geometryType === "line"
      ? await Promise.all(shapeAssetConnectionTargets.map((target) => client.rpc("maps_connect_point_to_line", {
        input_organization_id: activeAccess.organizationId,
        input_point_feature_id: target.featureId,
        input_line_feature_id: featureId,
      })))
      : [];
    const assetConnectionError = assetConnectionResults.find((result) => result.error)?.error || null;
    setSaving(false);
    if (detailResult.error) showToast(`Shape saved, but its details need attention: ${detailResult.error.message}`);
    else if (assetConnectionError) showToast(`Line saved, but an asset connection needs attention: ${assetConnectionError.message}`);
    setPendingShape(null);
    setShapeAssetConnectionTargets([]);
    await loadWorkspace(client, activeAccess);
    setSelectedFeatureId(featureId);
    if (!detailResult.error && !assetConnectionError) showToast(pendingShape.geometryType === "line" && assetConnectionResults.length
      ? `Line saved and connected to ${assetConnectionResults.length} asset${assetConnectionResults.length === 1 ? "" : "s"}`
      : pendingShape.geometryType === "line" ? "Line saved" : "Boundary saved");
  };

  const openEventDialog = (nextType: MapEventType = "inspection") => {
    setEventType(nextType);
    setEventDialogOpen(true);
  };

  const beginBreakPlacement = () => {
    if (!selectedFeature || !selectedFeatureSupportsWaterBreak || !canEdit) return;
    setPlacementMode(false);
    setShapeDraft(null);
    setPendingShape(null);
    setMovingFeatureId(null);
    setSelectedIncidentId(null);
    setBreakPlacementFeatureId(selectedFeature.id);
    showToast("Click the exact break location on the selected line");
  };

  const updateFlowDirection = async (flowDirection: MapFeature["flow_direction"]) => {
    if (!client || !activeAccess || !selectedFeature || selectedFeature.geometry_type !== "line" || !canEdit) return;
    setSaving(true);
    const { error } = await client.rpc("set_map_line_flow_direction", {
      input_organization_id: activeAccess.organizationId,
      input_feature_id: selectedFeature.id,
      input_flow_direction: flowDirection,
    });
    setSaving(false);
    if (error) {
      showToast(error.message);
      return;
    }
    await loadWorkspace(client, activeAccess);
    setSelectedFeatureId(selectedFeature.id);
    showToast(flowDirection === "unknown" ? "Flow direction cleared" : "Flow direction saved");
  };

  const connectPointToLine = async (pointFeatureId: string, lineFeatureId: string) => {
    if (!client || !activeAccess || !canEdit) return;
    setSaving(true);
    const { error } = await client.rpc("maps_connect_point_to_line", {
      input_organization_id: activeAccess.organizationId,
      input_point_feature_id: pointFeatureId,
      input_line_feature_id: lineFeatureId,
    });
    setSaving(false);
    if (error) {
      showToast(error.message);
      return;
    }
    await loadWorkspace(client, activeAccess);
    setSelectedFeatureId(pointFeatureId);
    showToast("Asset connected to the utility line");
  };

  const disconnectPointFromLine = async (pointFeatureId: string) => {
    if (!client || !activeAccess || !canEdit) return;
    setSaving(true);
    const { error } = await client.rpc("maps_disconnect_point_from_line", {
      input_organization_id: activeAccess.organizationId,
      input_point_feature_id: pointFeatureId,
    });
    setSaving(false);
    if (error) {
      showToast(error.message);
      return;
    }
    await loadWorkspace(client, activeAccess);
    setSelectedFeatureId(pointFeatureId);
    showToast("Line connection removed");
  };

  const beginValvePlacement = () => {
    if (!selectedFeature || !selectedFeatureSupportsWaterBreak || !canEdit) return;
    const firstValveLayer = valveLayers[0];
    if (!firstValveLayer) {
      const preset = STANDARD_LAYER_PRESETS.find((item) => item.key === "water-valve");
      if (preset) chooseLayerPreset(preset.key);
      setLayerDialogOpen(true);
      showToast("Create a Water valves layer first, then insert the valve");
      return;
    }
    setValveLayerId(firstValveLayer.id);
    setPlacementMode(false);
    setShapeDraft(null);
    setPendingShape(null);
    setMovingFeatureId(null);
    setBreakPlacementFeatureId(null);
    setSelectedIncidentId(null);
    setValvePlacementFeatureId(selectedFeature.id);
    showToast("Click the exact valve location on the selected water line");
  };

  const cancelValvePlacement = () => {
    setValvePlacementFeatureId(null);
    setPendingValveLocation(null);
    setValveDialogOpen(false);
  };

  const insertValve = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || !activeAccess || !pendingValveLocation || !valveLayerId || !canEdit) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    const { data, error } = await client.rpc("maps_insert_valve_on_line", {
      input_organization_id: activeAccess.organizationId,
      input_line_feature_id: pendingValveLocation.featureId,
      input_valve_layer_id: valveLayerId,
      input_longitude: pendingValveLocation.longitude,
      input_latitude: pendingValveLocation.latitude,
      input_title: String(form.get("title") || "Isolation valve").trim(),
      input_reference_code: String(form.get("reference_code") || "").trim() || null,
      input_description: String(form.get("description") || "").trim() || null,
    });
    setSaving(false);
    if (error) {
      showToast(error.message || "The valve could not be inserted.");
      return;
    }
    const valveFeatureId = String((data as { valveFeatureId?: unknown } | null)?.valveFeatureId || "");
    setValveDialogOpen(false);
    setPendingValveLocation(null);
    await loadWorkspace(client, activeAccess);
    setSelectedFeatureId(valveFeatureId || null);
    showToast("Valve inserted and water main split into connected segments");
  };

  const cancelBreakPlacement = () => {
    setBreakPlacementFeatureId(null);
    setPendingBreakLocation(null);
    setBreakStartDialogOpen(false);
  };

  const startBreakIncident = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || !activeAccess || !pendingBreakLocation || !canEdit) return;
    const form = new FormData(event.currentTarget);
    const startedAt = String(form.get("started_at") || "");
    setSaving(true);
    const { data, error } = await client.rpc("maps_start_break_incident", {
      input_organization_id: activeAccess.organizationId,
      input_feature_id: pendingBreakLocation.featureId,
      input_longitude: pendingBreakLocation.longitude,
      input_latitude: pendingBreakLocation.latitude,
      input_title: String(form.get("title") || "Water-main break").trim(),
      input_initial_report: String(form.get("initial_report") || "").trim() || null,
      input_severity: String(form.get("severity") || "urgent"),
      input_started_at: new Date(startedAt).toISOString(),
      input_customers_affected_estimate: form.get("customers_affected_estimate") ? Number(form.get("customers_affected_estimate")) : null,
      input_customer_reference: String(form.get("customer_reference") || "").trim() || null,
      input_request_reference: String(form.get("request_reference") || "").trim() || null,
    });
    setSaving(false);
    if (error) {
      showToast(error.message || "The break incident could not be started.");
      return;
    }
    const incidentId = String((data as { incidentId?: unknown } | null)?.incidentId || "");
    const featureId = pendingBreakLocation.featureId;
    setBreakStartDialogOpen(false);
    setPendingBreakLocation(null);
    await loadWorkspace(client, activeAccess);
    setSelectedFeatureId(featureId);
    setSelectedIncidentId(incidentId || null);
    showToast("Break incident started and highlighted");
  };

  const chooseIncidentUpdateType = (type: MapIncidentUpdate["update_type"]) => {
    setIncidentUpdateType(type);
    setIncidentUpdateStatus(INCIDENT_UPDATE_TYPES.find((item) => item.value === type)?.suggestedStatus || "repairing");
  };

  const addIncidentUpdate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || !activeAccess || !selectedIncident || !canEdit) return;
    const form = new FormData(event.currentTarget);
    const occurredAt = String(form.get("occurred_at") || "");
    setSaving(true);
    const { error } = await client.rpc("maps_add_incident_update", {
      input_organization_id: activeAccess.organizationId,
      input_incident_id: selectedIncident.id,
      input_update_type: incidentUpdateType,
      input_status_after: incidentUpdateStatus,
      input_note: String(form.get("note") || "").trim(),
      input_occurred_at: new Date(occurredAt).toISOString(),
      input_details: {},
    });
    setSaving(false);
    if (error) {
      showToast(error.message || "The incident update could not be added.");
      return;
    }
    const incidentId = selectedIncident.id;
    setIncidentUpdateDialogOpen(false);
    await loadWorkspace(client, activeAccess);
    setSelectedIncidentId(incidentId);
    showToast("Incident update added");
  };

  const saveIsolationPlan = async (estimate: IncidentIsolationEstimate) => {
    if (!client || !activeAccess || !selectedIncident || !canEdit) return false;
    const { error } = await client.rpc("maps_save_incident_isolation_plan", {
      input_organization_id: activeAccess.organizationId,
      input_incident_id: selectedIncident.id,
      input_recommended_valve_ids: estimate.requiredValveIds,
      input_isolated_feature_ids: estimate.isolatedFeatureIds,
      input_affected_meter_ids: estimate.affectedMeterIds,
      input_customer_references: estimate.customerReferences,
      input_topology_complete: estimate.topologyComplete,
      input_warnings: estimate.warnings,
    });
    if (error) {
      showToast(error.message || "The isolation plan could not be saved.");
      return false;
    }
    return true;
  };

  const setIncidentValveStatus = async (valveFeatureId: string, status: MapIncidentValveStatus) => {
    if (!client || !activeAccess || !selectedIncident || !selectedIsolationEstimate || !canEdit) return;
    setSaving(true);
    const occurredAt = new Date().toISOString();
    const { error } = await client.rpc("maps_set_incident_valve_status", {
      input_organization_id: activeAccess.organizationId,
      input_incident_id: selectedIncident.id,
      input_valve_feature_id: valveFeatureId,
      input_status: status,
      input_note: null,
      input_occurred_at: occurredAt,
    });
    if (error) {
      setSaving(false);
      showToast(error.message || "The valve status could not be saved.");
      return;
    }
    const nextActions = [...incidentValveActions, {
      id: `pending-${occurredAt}`,
      organization_id: activeAccess.organizationId,
      incident_id: selectedIncident.id,
      valve_feature_id: valveFeatureId,
      status,
      note: null,
      occurred_at: occurredAt,
      created_by_user_id: null,
      submitted_at: occurredAt,
    } satisfies MapIncidentValveAction];
    const nextEstimate = calculateIncidentIsolation(
      selectedIncident, features, layers, networkConnections, networkDevices, pointLineConnections, nextActions,
    );
    await saveIsolationPlan(nextEstimate);
    await loadWorkspace(client, activeAccess);
    setSelectedIncidentId(selectedIncident.id);
    setSaving(false);
    showToast(status === "inaccessible" || status === "inoperable"
      ? "Plan expanded to the next mapped valve"
      : `Valve marked ${status.replaceAll("_", " ")}`);
  };

  const closeBreakIncident = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || !activeAccess || !selectedIncident || !canEdit) return;
    const form = new FormData(event.currentTarget);
    const resolvedAt = String(form.get("resolved_at") || "");
    setSaving(true);
    if (selectedIsolationEstimate && !(await saveIsolationPlan(selectedIsolationEstimate))) {
      setSaving(false);
      return;
    }
    const { error } = await client.rpc("maps_close_break_incident", {
      input_organization_id: activeAccess.organizationId,
      input_incident_id: selectedIncident.id,
      input_resolved_at: new Date(resolvedAt).toISOString(),
      input_summary: String(form.get("summary") || "").trim(),
      input_cause: String(form.get("cause") || "").trim() || null,
      input_repair_method: String(form.get("repair_method") || "").trim() || null,
      input_customers_affected_estimate: form.get("customers_affected_estimate") ? Number(form.get("customers_affected_estimate")) : null,
      input_pressure_lost: form.get("pressure_lost") === "on",
      input_disinfected: form.get("disinfected") === "on",
      input_sample_collected: form.get("sample_collected") === "on",
      input_chlorine_residual: String(form.get("chlorine_residual") || "").trim() || null,
      input_sample_result: String(form.get("sample_result") || "").trim() || null,
    });
    setSaving(false);
    if (error) {
      showToast(error.message || "The incident could not be resolved.");
      return;
    }
    const featureId = selectedIncident.feature_id;
    setIncidentCloseDialogOpen(false);
    setSelectedIncidentId(null);
    await loadWorkspace(client, activeAccess);
    setSelectedFeatureId(featureId);
    setAssetPanelTab("history");
    showToast("Incident resolved and permanent history created");
  };

  const saveEvent = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || !activeAccess || !selectedFeature || !canEdit) return;
    const form = new FormData(event.currentTarget);
    const selectedType = String(form.get("event_type")) as MapEventType;
    const occurredAt = String(form.get("occurred_at") || "");
    const selectedTemplate = EVENT_TYPES.find((item) => item.value === selectedType);
    setSaving(true);
    const { error } = await client.from("map_events").insert({
      organization_id: activeAccess.organizationId,
      feature_id: selectedFeature.id,
      sequence_number: 1,
      event_type: selectedType,
      title: String(form.get("title") || selectedTemplate?.label || "Map event").trim(),
      summary: String(form.get("summary") || "").trim() || null,
      severity: String(form.get("severity") || "routine"),
      compliance_basis: selectedTemplate?.compliance || "operational",
      occurred_at: new Date(occurredAt).toISOString(),
      resolved_at: form.get("resolved") === "on" ? new Date(occurredAt).toISOString() : null,
      details: eventDetailsFromForm(form, selectedType),
      customer_reference: String(form.get("customer_reference") || selectedFeature.customer_reference || "").trim() || null,
      request_reference: String(form.get("request_reference") || "").trim() || null,
      record_hash: "0".repeat(64),
    });
    setSaving(false);
    if (error) {
      showToast(error.message || "The event could not be submitted.");
      return;
    }
    setEventDialogOpen(false);
    await loadWorkspace(client, activeAccess);
    setSelectedFeatureId(selectedFeature.id);
    setAssetPanelTab("history");
    showToast("Permanent history added");
  };

  const saveTask = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || !activeAccess || !selectedFeature || !canEdit) return;
    const form = new FormData(event.currentTarget);
    const dueAt = String(form.get("due_at") || "");
    setSaving(true);
    const { error } = await client.from("map_tasks").insert({
      organization_id: activeAccess.organizationId,
      feature_id: selectedFeature.id,
      title: String(form.get("title") || "").trim(),
      category: String(form.get("category") || "maintenance"),
      description: String(form.get("description") || "").trim() || null,
      priority: String(form.get("priority") || "normal"),
      compliance_basis: String(form.get("compliance_basis") || "operational"),
      due_at: dueAt ? new Date(dueAt).toISOString() : null,
      customer_reference: String(form.get("customer_reference") || selectedFeature.customer_reference || "").trim() || null,
      request_reference: String(form.get("request_reference") || "").trim() || null,
    });
    setSaving(false);
    if (error) {
      showToast(error.message || "The task could not be created.");
      return;
    }
    setTaskDialogOpen(false);
    await loadWorkspace(client, activeAccess);
    setSelectedFeatureId(selectedFeature.id);
    setAssetPanelTab("tasks");
    showToast("Task added");
  };

  const completeTask = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || !activeAccess || !selectedFeature || !taskCompleting || !canEdit) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    const { error } = await client.rpc("maps_complete_task", {
      input_organization_id: activeAccess.organizationId,
      input_task_id: taskCompleting.id,
      input_completion_summary: String(form.get("completion_summary") || "").trim() || null,
    });
    setSaving(false);
    if (error) {
      showToast(error.message || "The task could not be completed.");
      return;
    }
    setTaskCompleting(null);
    await loadWorkspace(client, activeAccess);
    setSelectedFeatureId(selectedFeature.id);
    setAssetPanelTab("history");
    showToast("Task completed and permanently recorded");
  };

  const saveFeatureDetails = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || !activeAccess || !selectedFeature || !canEdit) return;
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") || "").trim();
    const fields = layerFields.filter((field) => field.layer_id === selectedFeature.layer_id);
    if (!title) return;
    setSaving(true);
    const { data, error } = await client
      .from("map_features")
      .update({
        title,
        reference_code: String(form.get("reference_code") || "").trim() || null,
        address: String(form.get("address") || "").trim() || null,
        customer_reference: String(form.get("customer_reference") || "").trim() || null,
        description: String(form.get("description") || "").trim() || null,
        status: String(form.get("status") || "active"),
        properties: { ...selectedFeature.properties, ...readCustomProperties(form, fields) },
      })
      .eq("id", selectedFeature.id)
      .eq("organization_id", activeAccess.organizationId)
      .select("id")
      .single();
    setSaving(false);
    if (error || !data) {
      showToast(error?.message || "That mapped item could not be updated.");
      return;
    }
    setFeatureEditOpen(false);
    await loadWorkspace(client, activeAccess);
    showToast("Mapped item updated");
  };

  const uploadFeaturePhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !client || !activeAccess || !selectedFeature || !canEdit) return;
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
    if (!allowedTypes.includes(file.type)) {
      showToast("Use a JPG, PNG, WebP, HEIC, or HEIF image.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showToast("Photos must be 10 MB or smaller.");
      return;
    }
    const extension = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const storagePath = `${activeAccess.organizationId}/${selectedFeature.id}/${crypto.randomUUID()}.${extension}`;
    setPhotoUploading(true);
    const uploadResult = await client.storage.from(MAPS_PHOTO_BUCKET).upload(storagePath, file, { contentType: file.type, upsert: false });
    if (uploadResult.error) {
      setPhotoUploading(false);
      showToast(uploadResult.error.message);
      return;
    }
    const recordResult = await client.from("map_feature_photos").insert({
      organization_id: activeAccess.organizationId,
      feature_id: selectedFeature.id,
      storage_path: storagePath,
      caption: file.name.slice(0, 500),
      mime_type: file.type,
      size_bytes: file.size,
    });
    if (recordResult.error) {
      await client.storage.from(MAPS_PHOTO_BUCKET).remove([storagePath]);
      setPhotoUploading(false);
      showToast(recordResult.error.message);
      return;
    }
    await loadWorkspace(client, activeAccess);
    setPhotoUploading(false);
    showToast("Photo added");
  };

  const deleteFeaturePhoto = async (photo: MapFeaturePhoto) => {
    if (!client || !activeAccess || !canEdit) return;
    setPhotoUploading(true);
    const storageResult = await client.storage.from(MAPS_PHOTO_BUCKET).remove([photo.storage_path]);
    const recordResult = storageResult.error ? null : await client.from("map_feature_photos").delete().eq("id", photo.id).eq("organization_id", activeAccess.organizationId);
    setPhotoUploading(false);
    if (storageResult.error || recordResult?.error) {
      showToast(storageResult.error?.message || recordResult?.error?.message || "Photo could not be deleted.");
      return;
    }
    await loadWorkspace(client, activeAccess);
    showToast("Photo deleted");
  };

  const archiveFeature = async () => {
    if (!client || !activeAccess || !selectedFeature || !canEdit) return;
    setSaving(true);
    const { data, error } = await client
      .from("map_features")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", selectedFeature.id)
      .eq("organization_id", activeAccess.organizationId)
      .select("id")
      .single();
    setSaving(false);
    if (error || !data) {
      showToast(error?.message || "That mapped item could not be deleted.");
      return;
    }
    setFeatureDeleteOpen(false);
    setFeatureEditOpen(false);
    setSelectedFeatureId(null);
    await loadWorkspace(client, activeAccess);
    showToast("Mapped item deleted");
  };

  const loadArchive = async (supabase = client, access = activeAccess) => {
    if (!supabase || !access) return;
    setArchiveLoading(true);
    const [layerResult, featureResult] = await Promise.all([
      supabase
        .from("map_layers")
        .select("id, organization_id, name, description, geometry_type, icon_key, color, archived_at")
        .eq("organization_id", access.organizationId)
        .not("archived_at", "is", null)
        .order("archived_at", { ascending: false }),
      supabase
        .from("map_features")
        .select("id, organization_id, layer_id, title, reference_code, archived_at")
        .eq("organization_id", access.organizationId)
        .not("archived_at", "is", null)
        .order("archived_at", { ascending: false }),
    ]);
    setArchiveLoading(false);
    if (layerResult.error || featureResult.error) {
      showToast(layerResult.error?.message || featureResult.error?.message || "Archive could not be loaded.");
      return;
    }
    setArchivedLayers((layerResult.data || []) as ArchivedLayer[]);
    setArchivedFeatures((featureResult.data || []) as ArchivedFeature[]);
  };

  const openArchive = () => {
    setArchiveOpen(true);
    void loadArchive();
  };

  const openLayerEditor = (layer: MapLayer) => {
    if (!canManageLayers) return;
    setEditingLayer(layer);
    setEditingLayerIconKey(layer.icon_key || "marker");
    setLayerFieldDrafts(layerFields.filter((field) => field.layer_id === layer.id).map((field) => ({
      id: field.id,
      fieldKey: field.field_key,
      label: field.label,
      fieldType: field.field_type,
      optionsText: field.options.join(", "),
      isRequired: field.is_required,
    })));
  };

  const addLayerFieldDraft = () => {
    setLayerFieldDrafts((current) => [...current, {
      fieldKey: "",
      label: "",
      fieldType: "text",
      optionsText: "",
      isRequired: false,
    }]);
  };

  const saveLayerDetails = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || !activeAccess || !editingLayer || !canManageLayers) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    if (!name) return;
    const layerColor = editingLayer.geometry_type === "point"
      ? mapSymbolColor(editingLayerIconKey)
      : String(form.get("color") || editingLayer.color);
    setSaving(true);
    const { data, error } = await client
      .from("map_layers")
      .update({
        name,
        description: String(form.get("description") || "").trim() || null,
        system_type: String(form.get("system_type") || editingLayer.system_type) as MapSystemType,
        icon_key: editingLayer.geometry_type === "point" ? editingLayerIconKey : "marker",
        color: layerColor,
        fill_color: layerColor,
        is_visible_by_default: form.get("is_visible_by_default") === "on",
      })
      .eq("id", editingLayer.id)
      .eq("organization_id", activeAccess.organizationId)
      .select("id")
      .single();
    if (error || !data) {
      setSaving(false);
      showToast(error?.message || "That layer could not be updated.");
      return;
    }
    const normalizedFields = layerFieldDrafts.filter((field) => field.label.trim()).map((field, index) => ({
      organization_id: activeAccess.organizationId,
      layer_id: editingLayer.id,
      field_key: field.fieldKey || fieldKeyFromLabel(field.label, `field_${index + 1}`),
      label: field.label.trim(),
      field_type: field.fieldType,
      options: field.fieldType === "select" ? field.optionsText.split(",").map((option) => option.trim()).filter(Boolean) : [],
      is_required: field.isRequired,
      sort_order: (index + 1) * 10,
    }));
    const uniqueKeys = new Set(normalizedFields.map((field) => field.field_key));
    if (uniqueKeys.size !== normalizedFields.length) {
      setSaving(false);
      showToast("Custom field names must be unique within a layer.");
      return;
    }
    const upsertResult = normalizedFields.length
      ? await client.from("map_layer_fields").upsert(normalizedFields, { onConflict: "organization_id,layer_id,field_key" })
      : { error: null };
    let deleteResult: { error: { message: string } | null } = { error: null };
    if (!upsertResult.error) {
      let deleteQuery = client.from("map_layer_fields").delete().eq("organization_id", activeAccess.organizationId).eq("layer_id", editingLayer.id);
      if (normalizedFields.length) deleteQuery = deleteQuery.not("field_key", "in", `(${normalizedFields.map((field) => field.field_key).join(",")})`);
      deleteResult = await deleteQuery;
    }
    setSaving(false);
    if (upsertResult.error || deleteResult.error) {
      showToast(upsertResult.error?.message || deleteResult.error?.message || "Custom fields could not be saved.");
      return;
    }
    setEditingLayer(null);
    await loadWorkspace(client, activeAccess);
    showToast("Layer updated");
  };

  const archiveLayer = async () => {
    if (!client || !activeAccess || !editingLayer || !canManageLayers) return;
    setSaving(true);
    const { error } = await client.rpc("maps_archive_layer", {
      input_organization_id: activeAccess.organizationId,
      input_layer_id: editingLayer.id,
    });
    setSaving(false);
    if (error) {
      showToast(error.message);
      return;
    }
    setLayerArchiveOpen(false);
    setEditingLayer(null);
    setSelectedFeatureId(null);
    await loadWorkspace(client, activeAccess);
    showToast("Layer moved to Archive");
  };

  const restoreArchivedLayer = async (layerId: string) => {
    if (!client || !activeAccess || !canManageLayers) return;
    setSaving(true);
    const { error } = await client.rpc("maps_restore_layer", {
      input_organization_id: activeAccess.organizationId,
      input_layer_id: layerId,
    });
    setSaving(false);
    if (error) {
      showToast(error.message);
      return;
    }
    await Promise.all([loadWorkspace(client, activeAccess), loadArchive(client, activeAccess)]);
    showToast("Layer restored");
  };

  const restoreArchivedFeature = async (featureId: string) => {
    if (!client || !activeAccess || !canEdit) return;
    setSaving(true);
    const { data, error } = await client
      .from("map_features")
      .update({ archived_at: null })
      .eq("id", featureId)
      .eq("organization_id", activeAccess.organizationId)
      .select("id")
      .single();
    setSaving(false);
    if (error || !data) {
      showToast(error?.message || "That mapped item could not be restored.");
      return;
    }
    await Promise.all([loadWorkspace(client, activeAccess), loadArchive(client, activeAccess)]);
    showToast("Mapped item restored");
  };

  const permanentlyDeleteArchivedItem = async () => {
    if (!client || !activeAccess || !permanentDeleteTarget || !canPermanentlyDelete) return;
    setSaving(true);
    let error: { message: string } | null = null;

    if (permanentDeleteTarget.type === "layer") {
      const manifestResult = await client.rpc("maps_archived_layer_storage_manifest", {
        input_organization_id: activeAccess.organizationId,
        input_layer_id: permanentDeleteTarget.id,
      });
      error = manifestResult.error;

      if (!error) {
        const storageByBucket = new Map<string, string[]>();
        for (const item of (manifestResult.data || []) as Array<{ bucket_id: string; object_name: string }>) {
          storageByBucket.set(item.bucket_id, [...(storageByBucket.get(item.bucket_id) || []), item.object_name]);
        }
        for (const [bucketId, objectNames] of storageByBucket) {
          for (let index = 0; index < objectNames.length; index += 100) {
            const removal = await client.storage.from(bucketId).remove(objectNames.slice(index, index + 100));
            if (removal.error) {
              error = removal.error;
              break;
            }
          }
          if (error) break;
        }
      }

      if (!error) {
        const purgeResult = await client.rpc("maps_permanently_delete_archived_layer", {
          input_organization_id: activeAccess.organizationId,
          input_layer_id: permanentDeleteTarget.id,
        });
        error = purgeResult.error;
      }
    } else {
      const deleteResult = await client
        .from("map_features")
        .delete()
        .eq("id", permanentDeleteTarget.id)
        .eq("organization_id", activeAccess.organizationId)
        .not("archived_at", "is", null)
        .select("id")
        .single();
      error = deleteResult.error;
    }

    setSaving(false);
    if (error) {
      showToast(error?.message || "That archived item could not be permanently deleted.");
      return;
    }
    const deletedLayer = permanentDeleteTarget.type === "layer";
    setPermanentDeleteTarget(null);
    await loadArchive(client, activeAccess);
    showToast(deletedLayer ? "Layer and all connected data permanently deleted" : "Archived item permanently deleted");
  };

  const beginMoveFeature = () => {
    if (!selectedFeature || selectedFeature.geometry.type !== "Point" || !canEdit) return;
    setMovingFeatureId(selectedFeature.id);
    setProposedMove(null);
    showToast("Drag the point or click its new position on the map.");
  };

  const cancelMoveFeature = () => {
    setMovingFeatureId(null);
    setProposedMove(null);
    showToast("Move canceled");
  };

  const proposeMoveFromGps = () => {
    if (!deviceLocation) {
      startLocating();
      showToast("Once your location appears, choose Use GPS again.");
      return;
    }
    const point: PointCoordinates = {
      longitude: deviceLocation.longitude,
      latitude: deviceLocation.latitude,
      placementMethod: "device_gps",
      accuracyMeters: deviceLocation.accuracyMeters,
    };
    if (movingFeatureId) {
      featureMarkersRef.current.get(movingFeatureId)?.setLngLat([point.longitude, point.latitude]);
    }
    setProposedMove(point);
  };

  const saveMovedFeature = async () => {
    if (!client || !activeAccess || !movingFeatureId || !proposedMove || !canEdit) return;
    setSaving(true);
    const { data, error } = await client.rpc("move_map_point", {
      input_organization_id: activeAccess.organizationId,
      input_feature_id: movingFeatureId,
      input_longitude: proposedMove.longitude,
      input_latitude: proposedMove.latitude,
      input_accuracy_m: proposedMove.accuracyMeters,
      input_placement_method: proposedMove.placementMethod,
    });
    const existingConnection = pointLineConnections.find((connection) => connection.point_feature_id === movingFeatureId);
    const connectionRefresh = !error && data && existingConnection
      ? await client.rpc("maps_connect_point_to_line", {
        input_organization_id: activeAccess.organizationId,
        input_point_feature_id: movingFeatureId,
        input_line_feature_id: existingConnection.line_feature_id,
      })
      : { error: null };
    if (connectionRefresh.error && existingConnection) {
      await client.rpc("maps_disconnect_point_from_line", {
        input_organization_id: activeAccess.organizationId,
        input_point_feature_id: movingFeatureId,
      });
    }
    setSaving(false);
    if (error || !data) {
      showToast(error?.message || "That point could not be moved.");
      return;
    }
    const movedFeatureId = movingFeatureId;
    setMovingFeatureId(null);
    setProposedMove(null);
    await loadWorkspace(client, activeAccess);
    setSelectedFeatureId(movedFeatureId);
    showToast(connectionRefresh.error ? "Point moved; its old line connection was removed" : "Point location updated");
  };

  const toggleLayer = (layerId: string) => {
    setVisibleLayers((current) => ({ ...current, [layerId]: current[layerId] === false }));
  };

  const beginManualPlacement = () => {
    if (!activeDrawingLayer) {
      showToast("Create or select an editable layer first.");
      return;
    }
    setEditingShapeId(null);
    setSelectedShapeVertexIndex(null);
    setShapeEditHistory([]);
    setShapeEditReview(false);
    setShapeAssetConnectionTargets([]);
    setSelectedFeatureId(null);
    if (activeDrawingLayer.geometry_type === "point") {
      setPlacementMode(true);
      showToast("Click the map to place the asset.");
      return;
    }
    if (activeDrawingLayer.geometry_type === "line" || activeDrawingLayer.geometry_type === "polygon") {
      setShapeHoverCoordinate(null);
      setShapeSnapTarget(null);
      setShapeDraft({ layerId: activeDrawingLayer.id, geometryType: activeDrawingLayer.geometry_type, coordinates: [] });
      showToast(activeDrawingLayer.geometry_type === "line" ? "Click the map to draw the line." : "Click the map to draw the boundary.");
      return;
    }
    showToast("Map overlays will be added with the import tools.");
  };

  const beginShapeEdit = () => {
    if (!selectedFeature || (selectedFeature.geometry_type !== "line" && selectedFeature.geometry_type !== "polygon") || !canEdit) return;
    const coordinates = geometryCoordinates(selectedFeature.geometry);
    const editableCoordinates = selectedFeature.geometry_type === "polygon" ? coordinates.slice(0, -1) : coordinates;
    setEditingShapeId(selectedFeature.id);
    setShapeDraft({ layerId: selectedFeature.layer_id, geometryType: selectedFeature.geometry_type, coordinates: editableCoordinates });
    setShapeHoverCoordinate(null);
    setShapeSnapTarget(null);
    setSelectedShapeVertexIndex(null);
    setShapeEditHistory([]);
    setShapeEditReview(false);
    setShapeAssetConnectionTargets([]);
    showToast("Drag a point, select one to remove it, or click the map to add a point.");
  };

  const undoShapeVertex = () => {
    if (!editingShapeId) {
      setShapeDraft((current) => {
        const removed = current?.coordinates.at(-1);
        if (removed) setShapeAssetConnectionTargets((targets) => targets.filter((target) => coordinateDistanceMeters(target.coordinate, removed) >= 0.05));
        return current ? { ...current, coordinates: current.coordinates.slice(0, -1) } : current;
      });
      return;
    }
    setShapeEditHistory((history) => {
      const previous = history.at(-1);
      if (previous) setShapeDraft((current) => current ? { ...current, coordinates: previous } : current);
      return previous ? history.slice(0, -1) : history;
    });
    setSelectedShapeVertexIndex(null);
  };

  const removeSelectedShapeVertex = () => {
    if (!shapeDraft || selectedShapeVertexIndex === null) return;
    const minimum = shapeDraft.geometryType === "line" ? 2 : 3;
    if (shapeDraft.coordinates.length <= minimum) {
      showToast(shapeDraft.geometryType === "line" ? "A line needs at least two points." : "A boundary needs at least three points.");
      return;
    }
    setShapeEditHistory((history) => [...history, shapeDraft.coordinates]);
    setShapeDraft({ ...shapeDraft, coordinates: shapeDraft.coordinates.filter((_, index) => index !== selectedShapeVertexIndex) });
    setSelectedShapeVertexIndex(null);
  };

  const cancelShapeDrawing = () => {
    const wasEditing = Boolean(editingShapeId);
    setShapeDraft(null);
    setPendingShape(null);
    setShapeHoverCoordinate(null);
    setShapeSnapTarget(null);
    setEditingShapeId(null);
    setSelectedShapeVertexIndex(null);
    setShapeEditHistory([]);
    setShapeEditReview(false);
    setShapeAssetConnectionTargets([]);
    showToast(wasEditing ? "Shape changes discarded" : "Drawing canceled");
  };

  const finishShapeDrawing = () => {
    if (!shapeDraft) return;
    const minimum = shapeDraft.geometryType === "line" ? 2 : 3;
    if (shapeDraft.coordinates.length < minimum) {
      showToast(shapeDraft.geometryType === "line" ? "Add at least two points to finish the line." : "Add at least three points to finish the boundary.");
      return;
    }
    if (editingShapeId) {
      setShapeEditReview(true);
      return;
    }
    setPendingShape(shapeDraft);
    setShapeDraft(null);
  };

  const saveEditedShape = async () => {
    if (!client || !activeAccess || !editingShapeId || !shapeDraft || !canEdit) return;
    setSaving(true);
    const { data, error } = await client.rpc("update_map_shape", {
      input_organization_id: activeAccess.organizationId,
      input_feature_id: editingShapeId,
      input_geometry: shapeGeometry(shapeDraft),
    });
    setSaving(false);
    if (error || !data) {
      showToast(error?.message || "That shape could not be updated.");
      return;
    }
    const updatedFeatureId = editingShapeId;
    setShapeDraft(null);
    setEditingShapeId(null);
    setShapeHoverCoordinate(null);
    setShapeSnapTarget(null);
    setSelectedShapeVertexIndex(null);
    setShapeEditHistory([]);
    setShapeEditReview(false);
    await loadWorkspace(client, activeAccess);
    setSelectedFeatureId(updatedFeatureId);
    showToast("Shape geometry updated");
  };

  return (
    <div className="maps-product">
      <header className="maps-header">
        <a className="maps-brand" href="/" aria-label="N3XRA home">
          <img src="/assets/n3xra_logo_transparent_small.png" alt="" />
          <span>N3XRA</span>
          <i />
          <strong>Maps</strong>
        </a>
        <div className="maps-header-actions">
          {activeAccess && accessList.length > 1 && (
            <label className="maps-organization-picker">
              <span>Workspace</span>
              <select value={activeAccess.organizationId} onChange={(event) => void chooseOrganization(event.target.value)}>
                {accessList.map((access) => <option value={access.organizationId} key={access.organizationId}>{access.organizationName}</option>)}
              </select>
            </label>
          )}
          {activeAccess && <span className="maps-role">{activeAccess.role.replace("_", " ")}</span>}
          {canManageLayers && <button type="button" className="maps-team-button" onClick={openTeamAccess}>Team access</button>}
          <a href={dashboardDestination.href}>{dashboardDestination.label}</a>
        </div>
      </header>

      <main className="maps-shell">
        <aside className={`maps-sidebar${sidebarOpen ? " is-open" : ""}`}>
          <div className="maps-sidebar-heading">
            <div><span>MAP LIBRARY</span><h1>{activeAccess?.organizationName || "Your map"}</h1></div>
            <button type="button" className="maps-mobile-close" onClick={() => setSidebarOpen(false)} aria-label="Close map library">×</button>
          </div>
          <label className="maps-search">
            <span aria-hidden="true">⌕</span>
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search mapped items" />
          </label>

          {activeIncidents.length > 0 && <section className="maps-active-incidents">
            <header><span>Active incidents</span><small>{activeIncidents.length}</small></header>
            <div>{activeIncidents.map((incident) => (
              <button type="button" className={`is-${incident.severity}${selectedIncidentId === incident.id ? " is-selected" : ""}`} key={incident.id} onClick={() => openIncident(incident)}>
                <i><WaterBreakIcon /></i><span><strong>INC-{String(incident.incident_number).padStart(5, "0")} · {incident.title}</strong><small>{incident.status} · {incident.severity}</small><small>{formatIncidentAge(incident.started_at)}</small></span><em>›</em>
              </button>
            ))}</div>
          </section>}

          {historicalIncidents.length > 0 && <section className="maps-past-breaks-toggle">
            <label><input type="checkbox" checked={showPastBreaks} onChange={(event) => setShowPastBreaks(event.target.checked)} /><i><WaterBreakIcon /></i><span><strong>Past breaks</strong><small>{historicalIncidents.length} resolved location{historicalIncidents.length === 1 ? "" : "s"}</small></span></label>
          </section>}

          <section className="maps-layers">
            <header><div><span>Layers</span><small>{layers.length}</small></div>{canEdit && <div className="maps-layer-header-actions"><button type="button" className="maps-archive-button" onClick={openArchive}>Archive</button>{canManageLayers && <button type="button" className="maps-add-layer-button" onClick={() => setLayerDialogOpen(true)} aria-label="Create layer">＋</button>}</div>}</header>
            {layers.length ? layers.map((layer) => (
              <div className="maps-layer-row" key={layer.id}>
                <label className="maps-layer">
                  <input type="checkbox" checked={visibleLayers[layer.id] !== false} onChange={() => toggleLayer(layer.id)} />
                  <LayerSwatch layer={layer} />
                  <span><strong>{layer.name}</strong><small>{layer.geometry_type} · {features.filter((feature) => feature.layer_id === layer.id).length} items</small></span>
                  {layer.geometry_type !== "raster" && layer.is_editable && canEdit && (
                    <input className="maps-layer-radio" type="radio" name="active-layer" checked={selectedLayerId === layer.id} onChange={() => setSelectedLayerId(layer.id)} aria-label={`Draw in ${layer.name}`} />
                  )}
                </label>
                {canManageLayers && <button type="button" className="maps-layer-settings" onClick={() => openLayerEditor(layer)} aria-label={`Edit ${layer.name} layer`}>•••</button>}
              </div>
            )) : (
              <div className="maps-empty-list"><strong>No layers yet</strong><p>Create a layer when you are ready to begin mapping.</p></div>
            )}
          </section>

          <section className="maps-results">
            <header><span>Mapped items</span><small>{filteredFeatures.length}</small></header>
            <div className="maps-result-list">
              {filteredFeatures.map((feature) => {
                const layer = layers.find((item) => item.id === feature.layer_id);
                const drawingLayer = shapeDraft?.geometryType === "line" ? layers.find((item) => item.id === shapeDraft.layerId) : null;
                const isConnectable = feature.geometry_type === "point" && Boolean(drawingLayer && drawingLayer.system_type !== "other" && drawingLayer.system_type !== "reference" && drawingLayer.system_type === layer?.system_type);
                return (
                  <button type="button" className={`${selectedFeatureId === feature.id ? "is-selected" : ""}${isConnectable ? " is-connectable" : ""}`} key={feature.id} onClick={() => { if (connectLineDrawingToAsset(feature)) return; setSelectedFeatureId(feature.id); setSidebarOpen(false); }}>
                    <LayerSwatch layer={layer} />
                    <span><strong>{feature.title}</strong><small>{feature.reference_code || layer?.name || "Mapped item"}</small></span>
                    <em>›</em>
                  </button>
                );
              })}
              {layers.length > 0 && filteredFeatures.length === 0 && <p className="maps-no-results">No mapped items match this view.</p>}
            </div>
          </section>
        </aside>

        <section className="maps-stage" aria-label="Interactive map">
          <div className="maps-map" ref={mapContainerRef} />
          {!mapboxToken && <div className="maps-map-notice">Add the Mapbox development token to display the map.</div>}
          {gate !== "ready" && (
            <div className={`maps-gate${gate === "setup" ? " is-setup" : ""}`}>
              <img className="maps-gate-logo" src="/assets/n3xra_logo_transparent_small.png" alt="" />
              <p>N3XRA MAPS</p>
              <h2>{gate === "loading" ? "Opening Maps" : gate === "signed-out" ? "Sign in to continue" : gate === "setup" ? "Set up your workspace" : gate === "unassigned" ? "Ready for activation" : "Maps needs attention"}</h2>
              <span className="maps-gate-message">{gateMessage}</span>
              {gate === "signed-out" && <a href="/account/?next=/maps/app/">Sign in</a>}
              {gate === "unassigned" && <a href={dashboardDestination.href}>Return to dashboard</a>}
              {gate === "setup" && (
                <form className="maps-activation" onSubmit={activateWorkspace}>
                  <div className="maps-activation-modes" role="group" aria-label="Workspace organization">
                    <button type="button" className={activationMode === "existing" ? "is-active" : ""} onClick={() => setActivationMode("existing")} disabled={!activationOptions?.organizations.length}>Existing organization</button>
                    <button type="button" className={activationMode === "new" ? "is-active" : ""} onClick={() => setActivationMode("new")}>New organization</button>
                  </div>
                  {activationMode === "existing" ? (
                    <div className="maps-activation-existing">
                      {activationOptions?.organizations.map((organization) => (
                        <label className={activationOrganizationId === organization.id ? "is-selected" : ""} key={organization.id}>
                          <input type="radio" name="maps-organization" value={organization.id} checked={activationOrganizationId === organization.id} onChange={() => setActivationOrganizationId(organization.id)} />
                          <span><strong>{organization.name}</strong><small>{organization.isOwner ? "You own this organization" : "You administer this organization"}</small></span>
                          {organization.mapsConnected && <em>Maps connected</em>}
                        </label>
                      ))}
                    </div>
                  ) : (
                    <label className="maps-activation-new">
                      <span>Organization name</span>
                      <input type="text" maxLength={160} value={newOrganizationName} onChange={(event) => setNewOrganizationName(event.target.value)} placeholder="Organization name" autoComplete="organization" />
                    </label>
                  )}
                  <div className="maps-activation-note"><strong>Your workspace starts empty.</strong><span>No layers, pins, customers, or preloaded information will be added.</span></div>
                  <button className="maps-activation-submit" type="submit" disabled={activating}>{activating ? "Creating workspace…" : "Create blank Maps workspace"}</button>
                </form>
              )}
            </div>
          )}

          <div className="maps-floating-tools">
            <button type="button" onClick={() => setSidebarOpen(true)} className="maps-library-button"><span>☰</span> Library</button>
            <div className="maps-style-switcher" aria-label="Map style">
              <button type="button" className={basemap === "standard" ? "is-active" : ""} onClick={() => setBasemap("standard")}>Map</button>
              <button type="button" className={basemap === "satellite" ? "is-active" : ""} onClick={() => setBasemap("satellite")}>Satellite</button>
            </div>
            <button type="button" className={`maps-legend-button${legendOpen ? " is-active" : ""}`} onClick={() => setLegendOpen((current) => !current)}>Legend</button>
          </div>

          {legendOpen && <aside className="maps-legend" aria-label="Map legend">
            <header><div><span>MAP LEGEND</span><strong>{activeAccess?.organizationName}</strong></div><button type="button" onClick={() => setLegendOpen(false)} aria-label="Close legend">×</button></header>
            <div>{activeIncidents.length > 0 && <article className="maps-legend-incident"><i><WaterBreakIcon /></i><span><strong>Active water-main break</strong><small>Operational incident requiring attention</small></span></article>}{layers.filter((layer) => visibleLayers[layer.id] !== false).map((layer) => <article key={layer.id}>
              <LayerSwatch layer={layer} />
              <span><strong>{layer.name}</strong><small>{features.filter((feature) => feature.layer_id === layer.id).length} mapped items</small></span>
            </article>)}</div>
            {!layers.some((layer) => visibleLayers[layer.id] !== false) && <p>No visible layers.</p>}
            <footer>Updates automatically from your visible layers.</footer>
          </aside>}

          {gate === "ready" && !navigationActive && (
            <div className="maps-field-tools">
              {valvePlacementFeatureId ? (
                <><button type="button" onClick={cancelValvePlacement}>× <span>Cancel valve</span></button><button type="button" className="is-active" disabled>⌖ <span>Click water line</span></button></>
              ) : breakPlacementFeatureId ? (
                <><button type="button" onClick={cancelBreakPlacement}>× <span>Cancel break</span></button><button type="button" className="is-incident" disabled>! <span>Click exact location</span></button></>
              ) : shapeDraft ? (
                <><button type="button" onClick={cancelShapeDrawing}>× <span>{editingShapeId ? "Discard" : "Cancel"}</span></button><button type="button" onClick={undoShapeVertex} disabled={editingShapeId ? !shapeEditHistory.length : !shapeDraft.coordinates.length}>↶ <span>Undo</span></button>{editingShapeId && <button type="button" onClick={removeSelectedShapeVertex} disabled={selectedShapeVertexIndex === null}>− <span>Remove point</span></button>}<button type="button" className="is-active" onClick={finishShapeDrawing}>✓ <span>{editingShapeId ? "Review" : shapeDraft.geometryType === "line" ? "Finish line" : "Finish boundary"}</span></button></>
              ) : movingFeatureId ? (
                <><button type="button" onClick={cancelMoveFeature}>× <span>Cancel move</span></button><button type="button" onClick={proposeMoveFromGps}>◎ <span>{deviceLocation ? "Use GPS" : "Locate me"}</span></button></>
              ) : (
                <><button type="button" onClick={locating ? () => stopLocating() : startLocating} className={deviceLocation ? "is-active" : ""} title={locating ? "Cancel location search" : "Find my location"}>◎ <span>{locating ? "Cancel" : deviceLocation ? "Center on me" : "Locate me"}</span></button>{canEdit && activeDrawingLayer && <button type="button" onClick={beginManualPlacement} className={placementMode ? "is-active" : ""}>＋ <span>{placementMode ? "Click map…" : activeDrawingLayer.geometry_type === "line" ? "Draw line" : activeDrawingLayer.geometry_type === "polygon" ? "Draw boundary" : "Place pin"}</span></button>}{canEdit && activeDrawingLayer?.geometry_type === "point" && <button type="button" onClick={placeAtCurrentLocation}>⌖ <span>Pin here</span></button>}</>
              )}
            </div>
          )}

          {movingFeatureId && !proposedMove && <div className="maps-move-banner"><strong>Move point</strong><span>Drag the selected point or click its new position.</span></div>}
          {valvePlacementFeatureId && <div className="maps-move-banner maps-valve-placement"><strong>Insert a connected valve</strong><span>Click directly on the selected water line. The line will split at that exact point.</span></div>}
          {breakPlacementFeatureId && <div className="maps-move-banner maps-incident-placement"><strong>Place the break</strong><span>Click the exact location on the selected water line.</span></div>}
          {shapeDraft && <div className="maps-move-banner maps-drawing-banner"><strong>{editingShapeId ? `Editing ${shapeDraft.geometryType === "line" ? "line" : "boundary"}` : shapeDraft.geometryType === "line" ? "Drawing line" : "Drawing boundary"}</strong><span>{shapeSnapTarget ? `Connect to ${shapeSnapTarget.title} · ${Math.max(1, Math.round(shapeSnapTarget.distanceMeters * 3.28084))} ft` : editingShapeId ? "Drag points · select a point to remove · click map to add" : shapeAssetConnectionTargets.length ? `Connected to ${shapeAssetConnectionTargets.map((target) => target.title).join(", ")} · click the map or another asset` : `${shapeDraft.coordinates.length} point${shapeDraft.coordinates.length === 1 ? "" : "s"} added · click the map or a compatible asset`}</span></div>}

          {locationError && <p className={`maps-location-error${locating ? " is-waiting" : ""}`} role="status">{locationError}</p>}

          {selectedFeature && !selectedIncidentId && !movingFeatureId && !editingShapeId && !directionsTargetId && (
            <article className="maps-detail-card">
              <button type="button" className="maps-detail-close" onClick={() => setSelectedFeatureId(null)} aria-label="Close mapped item">×</button>
              <div className="maps-detail-icon" style={{ color: mapSymbolColor(selectedLayer?.icon_key || "marker") }}><MapSymbol iconKey={selectedLayer?.icon_key || "marker"} /></div>
              <div className="maps-detail-title"><span>{selectedLayer?.name || "Mapped item"}</span><h2>{selectedFeature.title}</h2>{selectedFeature.reference_code && <p>{selectedFeature.reference_code}</p>}</div>
              {selectedFeature.description && <p className="maps-detail-description">{selectedFeature.description}</p>}
              <div className="maps-detail-actions">{selectedFeature.geometry_type === "point" && <button type="button" className="maps-detail-directions" onClick={() => startDirections(selectedFeature)}>Directions</button>}{canEdit && <><button type="button" className="maps-detail-edit" onClick={() => setFeatureEditOpen(true)}>Edit item</button>{selectedFeature.geometry_type === "point" ? <button type="button" className="maps-detail-move" onClick={beginMoveFeature}>Move point</button> : <button type="button" className="maps-detail-move" onClick={beginShapeEdit}>Edit shape</button>}{selectedFeatureSupportsWaterBreak && <button type="button" className="maps-detail-valve" onClick={beginValvePlacement}>Insert valve</button>}<button type="button" className="maps-detail-delete" onClick={() => setFeatureDeleteOpen(true)}>Delete item</button></>}</div>
              <nav className="maps-asset-tabs" aria-label="Mapped item sections">
                {(["details", "history", "tasks", "files"] as AssetPanelTab[]).map((tab) => (
                  <button type="button" className={assetPanelTab === tab ? "is-active" : ""} onClick={() => setAssetPanelTab(tab)} key={tab}>
                    {tab}{tab === "history" && selectedEvents.length > 0 ? ` ${selectedEvents.length}` : tab === "tasks" && selectedTasks.filter((task) => task.status !== "completed").length > 0 ? ` ${selectedTasks.filter((task) => task.status !== "completed").length}` : ""}
                  </button>
                ))}
              </nav>

              {assetPanelTab === "details" && <section className="maps-asset-tab-panel">
                <dl>
                  <div><dt>Status</dt><dd>{selectedFeature.status}</dd></div>
                  <div><dt>Placed with</dt><dd>{selectedFeature.placement_method.replace("_", " ")}</dd></div>
                  {selectedFeature.location_accuracy_m !== null && <div><dt>Recorded accuracy</dt><dd>±{Math.round(selectedFeature.location_accuracy_m * 3.28084)} ft</dd></div>}
                  {selectedFeature.address && <div className="maps-detail-wide"><dt>Address</dt><dd>{selectedFeature.address}</dd></div>}
                  {selectedFeature.customer_reference && <div className="maps-detail-wide"><dt>Customer reference</dt><dd>{selectedFeature.customer_reference}</dd></div>}
                  {selectedFields.map((field) => {
                    const value = selectedFeature.properties?.[field.field_key];
                    if (value === null || value === undefined || value === "") return null;
                    return <div key={field.id}><dt>{field.label}</dt><dd>{field.field_type === "boolean" ? value ? "Yes" : "No" : String(value)}</dd></div>;
                  })}
                </dl>
                <div className="maps-coordinate-detail">{selectedFeature.geometry_type === "point" ? pointCoordinates(selectedFeature)?.slice().reverse().map((coordinate) => coordinate.toFixed(7)).join(", ") : `${selectedFeature.geometry_type === "line" ? "Line" : "Boundary"} · ${geometryCoordinates(selectedFeature.geometry).length - (selectedFeature.geometry_type === "polygon" ? 1 : 0)} points`}</div>
                {selectedFeature.geometry_type === "line" && <div className={`maps-network-status${selectedNetworkConnections.length ? " is-connected" : ""}`}><span>NETWORK</span><strong>{selectedNetworkConnections.length ? `${selectedNetworkConnections.length} connected line${selectedNetworkConnections.length === 1 ? "" : "s"}` : "No connected lines yet"}</strong><small>{selectedNetworkConnections.length ? "Saved as utility-network relationships for future flow and shutoff analysis." : "Draw a compatible utility line endpoint within 10 ft to connect it."}</small>{canEdit && <label className="maps-flow-control"><span>Flow direction</span><select value={selectedFeature.flow_direction || "unknown"} disabled={saving} onChange={(event) => void updateFlowDirection(event.target.value as MapFeature["flow_direction"])}><option value="unknown">Not set</option><option value="start_to_end">First point → last point</option><option value="end_to_start">Last point → first point</option></select><small>Directional arrows appear on the line and are retained when a valve splits it.</small></label>}</div>}
                {selectedFeature.geometry_type === "point" && Array.isArray(selectedFeature.properties?.connectedLineIds) && <div className="maps-network-status is-connected"><span>NETWORK</span><strong>Connected network device</strong><small>This asset is inserted directly into {selectedFeature.properties.connectedLineIds.length} utility line segment{selectedFeature.properties.connectedLineIds.length === 1 ? "" : "s"}.</small></div>}
                {selectedFeature.geometry_type === "point" && !Array.isArray(selectedFeature.properties?.connectedLineIds) && (selectedPointLineConnection || selectedPointConnectionCandidate) && <div className={`maps-network-status${selectedPointLineConnection ? " is-connected" : ""}`}>
                  <span>UTILITY CONNECTION</span>
                  <strong>{selectedPointLineConnection ? `Connected to ${selectedConnectedLine?.title || "utility line"}` : `Connect to ${selectedPointConnectionCandidate?.featureTitle}?`}</strong>
                  <small>{selectedPointLineConnection ? `${selectedConnectedLineLayer?.name || "Utility line"} · ${Math.max(0, Math.round(Number(selectedPointLineConnection.distance_m) * 3.28084))} ft from the mapped point` : `${selectedPointConnectionCandidate?.layerName} · ${Math.max(0, Math.round((selectedPointConnectionCandidate?.distanceMeters || 0) * 3.28084))} ft away. This records the actual network relationship.`}</small>
                  {canEdit && (selectedPointLineConnection
                    ? <button type="button" disabled={saving} onClick={() => void disconnectPointFromLine(selectedFeature.id)}>Disconnect</button>
                    : selectedPointConnectionCandidate && <button type="button" disabled={saving} onClick={() => void connectPointToLine(selectedFeature.id, selectedPointConnectionCandidate.featureId)}>Connect to this line</button>)}
                </div>}
                {selectedFeature.geometry_type === "point" && <div className="maps-proximity">
                  <span>FIELD LOCATION</span>
                  <strong>{selectedDistance === null ? "Start locating to measure distance" : formatDistance(selectedDistance)}</strong>
                  <small>{deviceLocation ? `Current GPS accuracy ±${Math.round(deviceLocation.accuracyMeters * 3.28084)} ft` : "Your device will report its current accuracy."}</small>
                  <button type="button" onClick={locating ? () => stopLocating() : startLocating}>{locating ? "Cancel location search" : deviceLocation ? "Center on me" : "Use my location"}</button>
                </div>}
              </section>}

              {assetPanelTab === "history" && <section className="maps-asset-tab-panel">
                <header className="maps-tab-heading"><div><strong>Permanent history</strong><span>Submitted records cannot be edited or deleted.</span></div>{canEdit && <div className="maps-tab-heading-actions">{selectedFeatureSupportsWaterBreak && <button type="button" className="is-incident" onClick={beginBreakPlacement}>! Start break</button>}<button type="button" onClick={() => openEventDialog()}>＋ Add event</button></div>}</header>
                <div className="maps-history-list">
                  {selectedEvents.map((item) => {
                    const historicalIncident = historicalIncidentByEventId.get(item.id);
                    const content = <><i aria-hidden="true" /><div><span>{eventTypeLabel(item.event_type)} · EVT-{String(item.sequence_number).padStart(5, "0")}</span><strong>{item.title}</strong><small>{formatHistoryDate(item.occurred_at)} · {item.compliance_basis.replace("_", " ")}</small>{item.summary && <p>{item.summary}</p>}<em title={item.record_hash}>Locked record · {item.record_hash.slice(0, 10)}</em>{historicalIncident && <b>View break location on map →</b>}</div></>;
                    return historicalIncident
                      ? <button type="button" key={item.id} className={`maps-history-record is-${item.severity}`} onClick={() => openHistoricalIncident(historicalIncident)}>{content}</button>
                      : <article key={item.id} className={`is-${item.severity}`}>{content}</article>;
                  })}
                  {!selectedEvents.length && <p className="maps-tab-empty">No history yet. Inspections, breaks, repairs, and completed tasks will appear here.</p>}
                </div>
              </section>}

              {assetPanelTab === "tasks" && <section className="maps-asset-tab-panel">
                <header className="maps-tab-heading"><div><strong>Tasks</strong><span>Schedule inspections, maintenance, reporting, and follow-up.</span></div>{canEdit && <button type="button" onClick={() => setTaskDialogOpen(true)}>＋ Add task</button>}</header>
                <div className="maps-task-list">
                  {selectedTasks.map((task) => <article key={task.id} className={`is-${task.priority}${task.status === "completed" ? " is-complete" : ""}`}>
                    <div><span>{task.category.replace("_", " ")} · {task.compliance_basis.replace("_", " ")}</span><strong>{task.title}</strong><small>{task.status === "completed" ? `Completed ${formatHistoryDate(task.completed_at || task.updated_at)}` : task.due_at ? `Due ${formatHistoryDate(task.due_at)}` : "No due date"}</small>{task.description && <p>{task.description}</p>}</div>
                    {canEdit && task.status !== "completed" && <button type="button" onClick={() => setTaskCompleting(task)}>Complete</button>}
                  </article>)}
                  {!selectedTasks.length && <p className="maps-tab-empty">No tasks yet. Add work without crowding the everyday map.</p>}
                </div>
              </section>}

              {assetPanelTab === "files" && <section className="maps-asset-tab-panel maps-asset-photos">
                <header><span>PHOTOS & EVIDENCE</span>{canEdit && <label className={photoUploading ? "is-disabled" : ""}>＋ Add photo<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" disabled={photoUploading} onChange={(event) => void uploadFeaturePhoto(event)} /></label>}</header>
                {selectedPhotos.length ? <div>{selectedPhotos.map((photo) => <figure key={photo.id}>{photoUrls[photo.id] ? <img src={photoUrls[photo.id]} alt={photo.caption || selectedFeature.title} /> : <span>Loading…</span>}<figcaption>{photo.caption || "Asset photo"}</figcaption>{canEdit && <button type="button" disabled={photoUploading} onClick={() => void deleteFeaturePhoto(photo)} aria-label={`Delete ${photo.caption || "asset photo"}`}>×</button>}</figure>)}</div> : <p>No photos or evidence added yet.</p>}
              </section>}
            </article>
          )}

          {selectedIncident && !directionsTargetId && (
            <article className={`maps-detail-card maps-incident-card is-${selectedIncident.severity}`}>
              <button type="button" className="maps-detail-close" onClick={() => setSelectedIncidentId(null)} aria-label="Close incident">×</button>
              <div className="maps-incident-heading"><i><WaterBreakIcon /></i><div><span>{selectedIncident.status === "resolved" ? "RESOLVED BREAK" : "ACTIVE BREAK"} · INC-{String(selectedIncident.incident_number).padStart(5, "0")}</span><h2>{selectedIncident.title}</h2><div><strong>{selectedIncident.status}</strong><em>{selectedIncident.severity}</em><small>{selectedIncident.status === "resolved" ? `Resolved ${formatHistoryDate(selectedIncident.resolved_at || selectedIncident.updated_at)}` : formatIncidentAge(selectedIncident.started_at)}</small></div></div></div>
              <dl>
                <div><dt>Started</dt><dd>{formatHistoryDate(selectedIncident.started_at)}</dd></div>
                <div><dt>Linked line</dt><dd>{features.find((feature) => feature.id === selectedIncident.feature_id)?.title || "Water line"}</dd></div>
                <div><dt>Location snap</dt><dd>{Math.round(Number(selectedIncident.snap_distance_m) * 3.28084)} ft</dd></div>
                {selectedIncident.customers_affected_estimate !== null && <div><dt>Estimated customers</dt><dd>{selectedIncident.customers_affected_estimate}</dd></div>}
              </dl>
              {selectedIncident.initial_report && <p className="maps-detail-description">{selectedIncident.initial_report}</p>}
              {selectedIncidentCloseEvent?.summary && <section className="maps-incident-resolution"><span>Final incident record</span><p>{selectedIncidentCloseEvent.summary}</p></section>}
              {(selectedIsolationEstimate || selectedSavedIsolationPlan) && <section className="maps-isolation-plan">
                <header><div><span>NETWORK ISOLATION</span><strong>{selectedIncident.status === "resolved" ? "Recorded isolation plan" : "Nearest required valves"}</strong></div><em>{selectedIncident.status === "resolved" ? "Locked" : `${selectedIsolationValves.filter((valve) => selectedValveStatuses.get(valve.id) === "closed").length}/${selectedIsolationValves.length} closed`}</em></header>
                <div className="maps-isolation-impact">
                  <div><strong>{selectedIncident.status === "resolved" ? selectedSavedIsolationPlan?.affected_meter_count ?? 0 : selectedIsolationEstimate?.affectedMeterIds.length ?? 0}</strong><span>meters affected</span></div>
                  <div><strong>{selectedIncident.status === "resolved" ? selectedSavedIsolationPlan?.affected_customer_count ?? 0 : selectedIsolationEstimate?.customerReferences.length ?? 0}</strong><span>customer accounts</span></div>
                  <div><strong>{selectedIncident.status === "resolved" ? selectedSavedIsolationPlan?.isolated_feature_ids.length ?? 0 : selectedIsolationEstimate?.isolatedFeatureIds.length ?? 0}</strong><span>line segments</span></div>
                </div>
                {selectedIncident.status !== "resolved" && <>
                  <p>The orange pipe section is the predicted isolated area. Valves are ordered nearest to the reported break. Closing every listed boundary valve isolates that area, including looped paths.</p>
                  {selectedIsolationValves.length ? <div className="maps-isolation-valves">{selectedIsolationValves.map((valve, index) => {
                    const status = selectedValveStatuses.get(valve.id) || "recommended";
                    const incidentLocation = geoPointCoordinates(selectedIncident.geometry);
                    const distance = incidentLocation ? metersBetween({ longitude: incidentLocation[0], latitude: incidentLocation[1], accuracyMeters: 0 }, valve) : null;
                    return <article key={valve.id} className={`is-${status}`}><i><MapSymbol iconKey="valve" /></i><div><span>STOP {index + 1}{distance !== null ? ` · ${formatDistance(distance)}` : ""}</span><strong>{valve.title}</strong><small>{status.replaceAll("_", " ")}</small></div><div className="maps-isolation-valve-actions"><button type="button" onClick={() => { startDirections(valve); if (canEdit && (status === "recommended" || status === "reopened")) void setIncidentValveStatus(valve.id, "en_route"); }}>Directions</button>{canEdit && status !== "closed" && <button type="button" disabled={saving} onClick={() => void setIncidentValveStatus(valve.id, status === "found" ? "closed" : "found")}>{status === "found" ? "Close valve" : "Found"}</button>}{canEdit && status === "closed" && <button type="button" disabled={saving} onClick={() => void setIncidentValveStatus(valve.id, "reopened")}>Reopened</button>}{canEdit && status !== "closed" && <button type="button" className="is-warning" disabled={saving} onClick={() => void setIncidentValveStatus(valve.id, "inaccessible")}>Can't access</button>}{canEdit && status !== "closed" && <button type="button" className="is-warning" disabled={saving} onClick={() => void setIncidentValveStatus(valve.id, "inoperable")}>Inoperable</button>}</div></article>;
                  })}</div> : <p className="maps-isolation-empty">No usable valve boundary was found. Add inserted valves and verify line-to-line connections before relying on this estimate.</p>}
                  {selectedUnavailableValves.length ? <div className="maps-isolation-bypassed"><strong>Bypassed valves</strong>{selectedUnavailableValves.map(({ feature, status }) => <span key={feature.id}>{feature.title} · {status}</span>)}</div> : null}
                  {selectedIsolationEstimate?.warnings.length ? <ul>{selectedIsolationEstimate.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
                  {canEdit && <button type="button" className="maps-save-isolation" disabled={saving || !selectedIsolationEstimate} onClick={() => { if (!selectedIsolationEstimate) return; setSaving(true); void saveIsolationPlan(selectedIsolationEstimate).then((saved) => { setSaving(false); if (saved) showToast("Isolation plan saved to the incident"); }); }}>{selectedSavedIsolationPlan ? "Save recalculated plan" : "Save plan to incident"}</button>}
                </>}
                {selectedIncident.status === "resolved" && selectedSavedIsolationPlan?.warnings.length ? <ul>{selectedSavedIsolationPlan.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
              </section>}
              {selectedIncident.status !== "resolved" && <div className="maps-incident-actions">{canEdit && <><button type="button" onClick={() => { setIncidentUpdateType("field_update"); setIncidentUpdateStatus(selectedIncident.status === "open" ? "responding" : selectedIncident.status as Exclude<MapIncidentStatus, "resolved">); setIncidentUpdateDialogOpen(true); }}>＋ Add update</button><button type="button" className="is-resolve" onClick={() => setIncidentCloseDialogOpen(true)}>✓ Resolve break</button></>}</div>}
              <section className="maps-incident-timeline"><header><strong>Incident timeline</strong><span>{selectedIncidentUpdates.length} permanent update{selectedIncidentUpdates.length === 1 ? "" : "s"}</span></header><div>{selectedIncidentUpdates.map((update) => <article key={update.id}><i /><div><span>{update.update_type.replaceAll("_", " ")}{update.status_after ? ` · ${update.status_after}` : ""}</span><strong>{update.note}</strong><small>{formatHistoryDate(update.occurred_at)}</small></div></article>)}</div></section>
            </article>
          )}

          {directionsTarget && !movingFeatureId && (
            <article className={`maps-route-card${navigationActive ? " is-navigating" : ""}`} aria-live="polite">
              <button type="button" className="maps-detail-close" onClick={clearDrivingRoute} aria-label="Close directions">×</button>
              <span className="maps-route-eyebrow">{navigationActive ? "● LIVE NAVIGATION" : "DRIVING DIRECTIONS"}</span>
              <h2>{directionsTarget.title}</h2>
              {drivingRoute && <div className="maps-route-summary"><strong>{formatRouteDuration(navigationProgressState?.remainingSeconds ?? drivingRoute.durationSeconds)}</strong><span>{formatRouteDistance(navigationProgressState?.remainingMeters ?? drivingRoute.distanceMeters)}</span>{navigationActive && navigationSpeedMps !== null && <em>{Math.max(0, Math.round(navigationSpeedMps * 2.23694))} mph</em>}</div>}
              {directionsLoading && <p className="maps-route-status">{navigationActive ? "Updating your live route…" : "Building the best available driving route…"}</p>}
              {directionsError && <p className="maps-route-error">{directionsError}</p>}
              {navigationActive && drivingRoute && (
                <div className={`maps-current-turn${navigationArrived ? " is-arrived" : ""}`}>
                  <span>{navigationArrived ? "ARRIVED" : "NEXT"}</span>
                  <strong>{navigationArrived ? `You have arrived at ${directionsTarget.title}.` : drivingRoute.steps[navigationProgressState?.stepIndex ?? 0]?.instruction || "Continue on the route"}</strong>
                  {!navigationArrived && drivingRoute.steps[navigationProgressState?.stepIndex ?? 0]?.roadName && <small>{drivingRoute.steps[navigationProgressState?.stepIndex ?? 0]?.roadName}</small>}
                  <small>Live GPS accuracy ±{Math.round((deviceLocation?.accuracyMeters || 0) * 3.28084)} ft</small>
                </div>
              )}
              {drivingRoute && !navigationActive && (
                <ol className="maps-route-steps">
                  {drivingRoute.steps.map((step, index) => <li key={`${step.instruction}-${index}`}><span>{index + 1}</span><div><strong>{step.instruction}</strong>{step.roadName && step.roadName !== step.instruction && <small>{step.roadName}</small>}</div><em>{formatRouteDistance(step.distanceMeters)}</em></li>)}
                </ol>
              )}
              <div className="maps-route-actions">
                {navigationActive ? <><button type="button" onClick={toggleVoiceGuidance}>{voiceGuidance ? "Mute voice" : "Unmute voice"}</button><button type="button" onClick={stopLiveNavigation}>Stop navigation</button></> : <><button type="button" disabled={!drivingRoute || !deviceLocation || directionsLoading} onClick={startLiveNavigation}>Start navigation</button><button type="button" disabled={!deviceLocation || directionsLoading} onClick={() => deviceLocation && void requestDrivingRoute(directionsTarget.id, deviceLocation)}>{directionsLoading ? "Updating…" : "Update route"}</button><button type="button" onClick={clearDrivingRoute}>Close</button></>}
              </div>
              <small className="maps-route-note">Keep this page open while navigating. Follow posted signs and road conditions.</small>
            </article>
          )}
        </section>
      </main>

      {teamOpen && (
        <div className="maps-dialog-backdrop" role="presentation">
          <section className="maps-dialog maps-team-dialog" role="dialog" aria-modal="true" aria-labelledby="maps-team-title">
            <header><div><span>MAPS ADMINISTRATION</span><h2 id="maps-team-title">Team access</h2></div><button type="button" onClick={() => setTeamOpen(false)} aria-label="Close">×</button></header>
            <div className="maps-team-copy"><p>Choose what each existing organization member can do in Maps. No one is assigned automatically.</p></div>
            <div className="maps-team-list">
              {teamLoading && !teamSnapshot && <p className="maps-team-empty">Loading organization members…</p>}
              {teamSnapshot?.members.map((member) => {
                const protectedMember = member.isOwner || member.userId === teamSnapshot.currentUserId;
                return <article className="maps-team-row" key={member.userId}>
                  <i aria-hidden="true">{member.fullName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</i>
                  <span><strong>{member.fullName}</strong><small>{member.email || "Organization member"}</small></span>
                  {protectedMember ? <em>{member.isOwner ? "Owner · Administrator" : `Your access · ${mapsRoleLabel(member.mapsRole)}`}</em> : <select aria-label={`Maps access for ${member.fullName}`} value={member.mapsRole || ""} disabled={teamSavingUserId === member.userId} onChange={(event) => void updateTeamMemberRole(member, (event.target.value || null) as MapsTeamMember["mapsRole"])}><option value="">No access</option><option value="viewer">Viewer</option><option value="editor">Editor</option><option value="account_admin">Administrator</option></select>}
                </article>;
              })}
              {teamSnapshot && !teamSnapshot.members.length && <p className="maps-team-empty">No organization members are available.</p>}
            </div>
            <div className="maps-team-guide"><div><strong>Administrator</strong><span>Manages Maps users, layers, archives, and assets.</span></div><div><strong>Editor</strong><span>Places and edits mapped assets without changing layer structure.</span></div><div><strong>Viewer</strong><span>Searches, reviews, locates, and navigates without changing data.</span></div></div>
            <footer><a href={`/client-portal/team/?organization=${encodeURIComponent(activeAccess?.organizationId || "")}`}>Add organization members</a><button type="button" onClick={() => setTeamOpen(false)}>Done</button></footer>
          </section>
        </div>
      )}

      {layerDialogOpen && (
        <div className="maps-dialog-backdrop" role="presentation">
          <section className="maps-dialog" role="dialog" aria-modal="true" aria-labelledby="new-layer-title">
            <header><div><span>MAP STRUCTURE</span><h2 id="new-layer-title">Create a layer</h2></div><button type="button" onClick={() => setLayerDialogOpen(false)} aria-label="Close">×</button></header>
            <form onSubmit={(event) => void saveLayer(event)}>
              <label className="maps-preset-select"><span>Start with a standard</span><select value={newLayerDraft.presetKey} onChange={(event) => chooseLayerPreset(event.target.value)}><option value="">Custom layer</option>{["Water", "Sanitary sewer", "Stormwater", "Reference"].map((group) => <optgroup label={group} key={group}>{STANDARD_LAYER_PRESETS.filter((preset) => preset.group === group).map((preset) => <option value={preset.key} key={preset.key}>{preset.name}</option>)}</optgroup>)}</select></label>
              {selectedNewLayerPreset && <div className="maps-standard-note"><LayerSwatch layer={{ geometry_type: selectedNewLayerPreset.geometryType, icon_key: selectedNewLayerPreset.iconKey, color: selectedNewLayerPreset.color }} /><span><strong>N3XRA recommended standard</strong><small>{selectedNewLayerPreset.standardNote} Names, details, and line or boundary colors can be adapted for your system.</small></span></div>}
              <label><span>Layer name</span><input name="name" value={newLayerDraft.name} onChange={(event) => setNewLayerDraft((current) => ({ ...current, name: event.target.value }))} required maxLength={100} placeholder="Meters, valves, district boundary…" /></label>
              <label><span>Description</span><input name="description" value={newLayerDraft.description} onChange={(event) => setNewLayerDraft((current) => ({ ...current, description: event.target.value }))} maxLength={180} placeholder="Optional" /></label>
              <label><span>Infrastructure system</span><select value={newLayerDraft.systemType} onChange={(event) => setNewLayerDraft((current) => ({ ...current, presetKey: "", systemType: event.target.value as MapSystemType }))}>{MAP_SYSTEM_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select><small>Connects this layer to the correct incidents, inspections, network tracing, and future customer requests.</small></label>
              <label><span>Geometry</span><select name="geometry_type" value={newLayerDraft.geometryType} onChange={(event) => chooseLayerGeometry(event.target.value as GeometryType)}><option value="point">Points</option><option value="line">Lines</option><option value="polygon">Polygons</option><option value="raster">Map overlay</option></select></label>
              {newLayerDraft.geometryType === "point" && <fieldset className="maps-symbol-fieldset"><legend>Choose an asset symbol</legend><div className="maps-symbol-picker">{MAP_SYMBOLS.map(([key, label]) => <button type="button" style={{ "--symbol-color": mapSymbolColor(key) } as React.CSSProperties} className={newLayerDraft.iconKey === key ? "is-selected" : ""} onClick={() => choosePointSymbol(key)} key={key} aria-pressed={newLayerDraft.iconKey === key}><MapSymbol iconKey={key} /><span>{label}</span></button>)}</div><small>Each symbol uses its predefined utility color so maps stay consistent.</small></fieldset>}
              {(newLayerDraft.geometryType === "line" || newLayerDraft.geometryType === "polygon") && <label className="maps-style-color"><span>{newLayerDraft.geometryType === "line" ? "Line color" : "Boundary color"}</span><input name="color" type="color" value={newLayerDraft.color} onChange={(event) => setNewLayerDraft((current) => ({ ...current, presetKey: "", color: event.target.value }))} /></label>}
              {newLayerDraft.geometryType === "raster" && <div className="maps-overlay-note"><strong>Map overlay</strong><span>Overlay source and opacity controls will appear when file imports are enabled. No asset symbol is needed.</span></div>}
              <div className={`maps-layer-preview is-${newLayerDraft.geometryType}`}>
                {newLayerDraft.geometryType === "point" ? <i style={{ color: mapSymbolColor(newLayerDraft.iconKey) }}><MapSymbol iconKey={newLayerDraft.iconKey} /></i> : newLayerDraft.geometryType === "line" ? <i className="is-line" style={{ color: newLayerDraft.color }} /> : newLayerDraft.geometryType === "polygon" ? <i className="is-area" style={{ color: newLayerDraft.color, background: `${newLayerDraft.color}2b` }} /> : <i className="is-overlay">▧</i>}
                <span><strong>{newLayerDraft.name || "Layer preview"}</strong><small>{newLayerDraft.geometryType}{selectedNewLayerPreset ? ` · ${selectedNewLayerPreset.fields.length} recommended fields included` : ""}</small></span>
              </div>
              <p>Standards are recommended starting points. Point symbols stay standardized; line and polygon colors can be adjusted for your system.</p>
              <footer><button type="button" onClick={() => setLayerDialogOpen(false)}>Cancel</button><button type="submit" className="is-primary" disabled={saving}>{saving ? "Creating…" : "Create layer"}</button></footer>
            </form>
          </section>
        </div>
      )}

      {editingLayer && (
        <div className="maps-dialog-backdrop" role="presentation">
          <section className="maps-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-layer-title">
            <header><div><span>MAP STRUCTURE</span><h2 id="edit-layer-title">Edit layer</h2></div><button type="button" onClick={() => setEditingLayer(null)} aria-label="Close">×</button></header>
            <form onSubmit={(event) => void saveLayerDetails(event)}>
              <label><span>Layer name</span><input name="name" required maxLength={100} defaultValue={editingLayer.name} /></label>
              <label><span>Description</span><input name="description" maxLength={500} defaultValue={editingLayer.description || ""} placeholder="Optional" /></label>
              <label><span>Infrastructure system</span><select name="system_type" defaultValue={editingLayer.system_type}>{MAP_SYSTEM_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select><small>Controls which operational workflows are available for this layer.</small></label>
              <label><span>Geometry</span><input value={editingLayer.geometry_type} disabled /></label>
              {editingLayer.geometry_type === "point" && <fieldset className="maps-symbol-fieldset"><legend>Asset symbol</legend><div className="maps-symbol-picker">{MAP_SYMBOLS.map(([key, label]) => <button type="button" style={{ "--symbol-color": mapSymbolColor(key) } as React.CSSProperties} className={editingLayerIconKey === key ? "is-selected" : ""} onClick={() => setEditingLayerIconKey(key)} key={key} aria-pressed={editingLayerIconKey === key}><MapSymbol iconKey={key} /><span>{label}</span></button>)}</div><small>Symbol colors are predefined to keep every map consistent.</small></fieldset>}
              {(editingLayer.geometry_type === "line" || editingLayer.geometry_type === "polygon") && <label className="maps-style-color"><span>{editingLayer.geometry_type === "line" ? "Line color" : "Boundary color"}</span><input name="color" type="color" defaultValue={editingLayer.color} /></label>}
              {editingLayer.geometry_type === "raster" && <div className="maps-overlay-note"><strong>Map overlay</strong><span>This layer has no asset symbol or utility color.</span></div>}
              <label className="maps-check-row"><input name="is_visible_by_default" type="checkbox" defaultChecked={editingLayer.is_visible_by_default} /><span>Show this layer by default</span></label>
              <section className="maps-custom-fields-editor">
                <header><div><strong>Custom asset fields</strong><span>These fields appear on every item in this layer.</span></div><button type="button" onClick={addLayerFieldDraft}>＋ Add field</button></header>
                {layerFieldDrafts.length ? <div>{layerFieldDrafts.map((field, index) => <article key={field.id || `new-${index}`}>
                  <input aria-label={`Custom field ${index + 1} label`} value={field.label} onChange={(event) => setLayerFieldDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))} placeholder="Field name" maxLength={100} required />
                  <select aria-label={`Custom field ${index + 1} type`} value={field.fieldType} onChange={(event) => setLayerFieldDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, fieldType: event.target.value as LayerFieldDraft["fieldType"] } : item))}><option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="boolean">Yes / No</option><option value="select">Choice list</option></select>
                  <label><input type="checkbox" checked={field.isRequired} onChange={(event) => setLayerFieldDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, isRequired: event.target.checked } : item))} /><span>Required</span></label>
                  <button type="button" className="is-remove" onClick={() => setLayerFieldDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${field.label || `custom field ${index + 1}`}`}>×</button>
                  {field.fieldType === "select" && <label className="maps-custom-field-options"><span>Available choices</span><input value={field.optionsText} onChange={(event) => setLayerFieldDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, optionsText: event.target.value } : item))} placeholder="PVC, Ductile iron, Cast iron…" required /><small>Separate each choice with a comma. These become the options shown when an asset is added or edited.</small></label>}
                </article>)}</div> : <p>No custom fields yet.</p>}
              </section>
              <p>Changing these settings updates every mapped item displayed in this layer.</p>
              <footer className="maps-layer-edit-footer"><button type="button" className="is-archive" onClick={() => setLayerArchiveOpen(true)}>Archive layer</button><span><button type="button" onClick={() => setEditingLayer(null)}>Cancel</button><button type="submit" className="is-primary" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button></span></footer>
            </form>
          </section>
        </div>
      )}

      {layerArchiveOpen && editingLayer && (
        <div className="maps-dialog-backdrop maps-dialog-backdrop-front" role="presentation">
          <section className="maps-dialog maps-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="archive-layer-title">
            <header><div><span>MAP LAYER</span><h2 id="archive-layer-title">Archive {editingLayer.name}?</h2></div><button type="button" onClick={() => setLayerArchiveOpen(false)} aria-label="Close">×</button></header>
            <div className="maps-confirm-copy"><p>The layer and its {features.filter((feature) => feature.layer_id === editingLayer.id).length} mapped items will leave the active map. You can restore them from Archive.</p></div>
            <footer><button type="button" onClick={() => setLayerArchiveOpen(false)}>Cancel</button><button type="button" className="is-danger" disabled={saving} onClick={() => void archiveLayer()}>{saving ? "Archiving…" : "Archive layer"}</button></footer>
          </section>
        </div>
      )}

      {archiveOpen && (
        <div className="maps-dialog-backdrop" role="presentation">
          <section className="maps-dialog maps-archive-dialog" role="dialog" aria-modal="true" aria-labelledby="maps-archive-title">
            <header><div><span>MAP LIBRARY</span><h2 id="maps-archive-title">Archive</h2></div><button type="button" onClick={() => setArchiveOpen(false)} aria-label="Close">×</button></header>
            <div className="maps-archive-content">
              {archiveLoading ? <p className="maps-archive-empty">Loading archived items…</p> : (
                <>
                  {archivedLayers.map((layer) => (
                    <article className="maps-archive-item" key={`layer-${layer.id}`}>
                      <LayerSwatch layer={layer} />
                      <span><strong>{layer.name}</strong><small>Layer · {archivedFeatures.filter((feature) => feature.layer_id === layer.id).length} mapped items</small></span>
                      {canManageLayers && <div><button type="button" onClick={() => void restoreArchivedLayer(layer.id)} disabled={saving}>Restore</button>{canPermanentlyDelete && <button type="button" className="is-delete" onClick={() => setPermanentDeleteTarget({ type: "layer", id: layer.id, name: layer.name })}>Delete</button>}</div>}
                    </article>
                  ))}
                  {archivedFeatures.filter((feature) => !archivedLayers.some((layer) => layer.id === feature.layer_id)).map((feature) => (
                    <article className="maps-archive-item" key={`feature-${feature.id}`}>
                      <LayerSwatch layer={[...layers, ...archivedLayers].find((layer) => layer.id === feature.layer_id)} />
                      <span><strong>{feature.title}</strong><small>Mapped item · {feature.reference_code || layers.find((layer) => layer.id === feature.layer_id)?.name || "Location"}</small></span>
                      <div><button type="button" onClick={() => void restoreArchivedFeature(feature.id)} disabled={saving}>Restore</button>{canPermanentlyDelete && <button type="button" className="is-delete" onClick={() => setPermanentDeleteTarget({ type: "feature", id: feature.id, name: feature.title })}>Delete</button>}</div>
                    </article>
                  ))}
                  {!archivedLayers.length && !archivedFeatures.length && <p className="maps-archive-empty">Archive is empty.</p>}
                </>
              )}
            </div>
            <footer><button type="button" onClick={() => setArchiveOpen(false)}>Done</button></footer>
          </section>
        </div>
      )}

      {permanentDeleteTarget && (
        <div className="maps-dialog-backdrop maps-dialog-backdrop-front" role="presentation">
          <section className="maps-dialog maps-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="permanent-delete-title">
            <header><div><span>PERMANENT DELETE</span><h2 id="permanent-delete-title">Delete {permanentDeleteTarget.name} forever?</h2></div><button type="button" onClick={() => setPermanentDeleteTarget(null)} aria-label="Close">×</button></header>
            <div className="maps-confirm-copy"><p>This cannot be undone. {permanentDeleteTarget.type === "layer" ? "The layer, every mapped item, immutable history, incidents, updates, tasks, photos, and linked file records inside it will be permanently removed." : "The mapped item will be permanently removed."}</p></div>
            <footer><button type="button" onClick={() => setPermanentDeleteTarget(null)}>Cancel</button><button type="button" className="is-danger" disabled={saving} onClick={() => void permanentlyDeleteArchivedItem()}>{saving ? "Deleting…" : "Delete forever"}</button></footer>
          </section>
        </div>
      )}

      {featureDialogOpen && pendingPoint && (
        <div className="maps-dialog-backdrop" role="presentation">
          <section className="maps-dialog" role="dialog" aria-modal="true" aria-labelledby="new-feature-title">
            <header><div><span>NEW LOCATION</span><h2 id="new-feature-title">Place a mapped item</h2></div><button type="button" onClick={() => setFeatureDialogOpen(false)} aria-label="Close">×</button></header>
            <form onSubmit={(event) => void savePoint(event)}>
              <label><span>Layer</span><select value={selectedLayerId} onChange={(event) => setSelectedLayerId(event.target.value)}>{layers.filter((layer) => layer.geometry_type === "point" && layer.is_editable).map((layer) => <option value={layer.id} key={layer.id}>{layer.name}</option>)}</select></label>
              {pendingPointConnectionCandidate && <label className="maps-connect-suggestion">
                <input type="checkbox" checked={connectNewPoint} onChange={(event) => setConnectNewPoint(event.target.checked)} />
                <span><strong>Connect to {pendingPointConnectionCandidate.featureTitle}?</strong><small>{pendingPointConnectionCandidate.layerName} · {Math.max(0, Math.round(pendingPointConnectionCandidate.distanceMeters * 3.28084))} ft from this point. This saves the utility relationship, not just the visual position.</small></span>
              </label>}
              <label><span>Title</span><input name="title" required maxLength={140} placeholder="Name this location" /></label>
              <label><span>Asset or reference number</span><input name="reference_code" maxLength={100} placeholder="Optional" /></label>
              <label><span>Address or location description</span><input name="address" maxLength={500} placeholder="Optional" /></label>
              <label><span>Customer/account reference</span><input name="customer_reference" maxLength={160} placeholder="Optional — does not connect a customer account yet" /></label>
              {layerFields.filter((field) => field.layer_id === selectedLayerId).map((field) => <label key={field.id}><span>{field.label}{field.is_required ? " *" : ""}</span>{field.field_type === "select" ? <select name={`custom_${field.field_key}`} required={field.is_required}><option value="">Select…</option>{field.options.map((option) => <option value={option} key={option}>{option}</option>)}</select> : field.field_type === "boolean" ? <input name={`custom_${field.field_key}`} type="checkbox" /> : <input name={`custom_${field.field_key}`} type={field.field_type === "number" ? "number" : field.field_type === "date" ? "date" : "text"} required={field.is_required} />}</label>)}
              <label><span>Notes</span><textarea name="description" maxLength={1_000} rows={3} placeholder="Optional field notes" /></label>
              <div className="maps-coordinate-readout"><span>{pendingPoint.latitude.toFixed(7)}, {pendingPoint.longitude.toFixed(7)}</span><small>{pendingPoint.accuracyMeters === null ? "Placed manually" : `Device accuracy ±${Math.round(pendingPoint.accuracyMeters * 3.28084)} ft`}</small></div>
              <footer><button type="button" onClick={() => setFeatureDialogOpen(false)}>Cancel</button><button type="submit" className="is-primary" disabled={saving}>{saving ? "Saving…" : "Save location"}</button></footer>
            </form>
          </section>
        </div>
      )}

      {pendingShape && (
        <div className="maps-dialog-backdrop" role="presentation">
          <section className="maps-dialog" role="dialog" aria-modal="true" aria-labelledby="new-shape-title">
            <header><div><span>NEW {pendingShape.geometryType === "line" ? "LINE" : "BOUNDARY"}</span><h2 id="new-shape-title">Save drawn {pendingShape.geometryType === "line" ? "line" : "boundary"}</h2></div><button type="button" onClick={cancelShapeDrawing} aria-label="Close">×</button></header>
            <form onSubmit={(event) => void saveShape(event)}>
              {shapeAssetConnectionTargets.length > 0 && <div className="maps-standard-note"><i className="maps-connection-arrow" aria-hidden="true">↳</i><span><strong>Connected to {shapeAssetConnectionTargets.map((target) => target.title).join(", ")}</strong><small>The line endpoint is snapped to the asset. Saving records the network relationship and updates any earlier line assignment for that asset.</small></span></div>}
              <label><span>Layer</span><input value={layers.find((layer) => layer.id === pendingShape.layerId)?.name || "Map layer"} disabled /></label>
              <label><span>Title</span><input name="title" required maxLength={140} placeholder={pendingShape.geometryType === "line" ? "Water main, service line…" : "District boundary, tax area…"} /></label>
              <label><span>Asset or reference number</span><input name="reference_code" maxLength={100} placeholder="Optional" /></label>
              <label><span>Address or location description</span><input name="address" maxLength={500} placeholder="Optional" /></label>
              <label><span>Customer/account reference</span><input name="customer_reference" maxLength={160} placeholder="Optional — does not connect a customer account yet" /></label>
              {layerFields.filter((field) => field.layer_id === pendingShape.layerId).map((field) => <label key={field.id}><span>{field.label}{field.is_required ? " *" : ""}</span>{field.field_type === "select" ? <select name={`custom_${field.field_key}`} required={field.is_required}><option value="">Select…</option>{field.options.map((option) => <option value={option} key={option}>{option}</option>)}</select> : field.field_type === "boolean" ? <input name={`custom_${field.field_key}`} type="checkbox" /> : <input name={`custom_${field.field_key}`} type={field.field_type === "number" ? "number" : field.field_type === "date" ? "date" : "text"} required={field.is_required} />}</label>)}
              <label><span>Notes</span><textarea name="description" maxLength={4_000} rows={3} placeholder="Optional field notes" /></label>
              <div className="maps-coordinate-readout"><span>{pendingShape.coordinates.length} mapped points</span><small>The saved shape stays tied to this layer and organization.</small></div>
              <footer><button type="button" onClick={cancelShapeDrawing}>Cancel</button><button type="submit" className="is-primary" disabled={saving}>{saving ? "Saving…" : pendingShape.geometryType === "line" ? "Save line" : "Save boundary"}</button></footer>
            </form>
          </section>
        </div>
      )}

      {shapeEditReview && editingShapeId && selectedFeature && shapeDraft && (
        <div className="maps-dialog-backdrop" role="presentation">
          <section className="maps-dialog maps-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="save-shape-edit-title">
            <header><div><span>SHAPE CHANGES</span><h2 id="save-shape-edit-title">Save the new shape?</h2></div><button type="button" onClick={() => setShapeEditReview(false)} aria-label="Close">×</button></header>
            <div className="maps-confirm-copy maps-move-confirmation"><p>This replaces the saved geometry for <strong>{selectedFeature.title}</strong>. Its layer, details, photos, and history remain connected.</p><div className="maps-coordinate-readout"><span>{shapeDraft.coordinates.length} mapped points</span><small>You can keep editing or save this reviewed shape.</small></div></div>
            <footer><button type="button" onClick={() => setShapeEditReview(false)}>Keep editing</button><button type="button" className="is-primary" disabled={saving} onClick={() => void saveEditedShape()}>{saving ? "Saving…" : "Save shape changes"}</button></footer>
          </section>
        </div>
      )}

      {valveDialogOpen && pendingValveLocation && (
        <div className="maps-dialog-backdrop" role="presentation">
          <section className="maps-dialog" role="dialog" aria-modal="true" aria-labelledby="insert-valve-title">
            <header><div><span>CONNECTED WATER NETWORK</span><h2 id="insert-valve-title">Insert isolation valve</h2></div><button type="button" onClick={cancelValvePlacement} aria-label="Close">×</button></header>
            <form onSubmit={(event) => void insertValve(event)}>
              <div className="maps-standard-note"><LayerSwatch layer={valveLayers.find((layer) => layer.id === valveLayerId)} /><span><strong>The water main will be split here.</strong><small>The original main keeps its records. A connected continuation and valve asset are created together.</small></span></div>
              <label><span>Water main</span><input value={features.find((feature) => feature.id === pendingValveLocation.featureId)?.title || "Selected water main"} disabled /></label>
              <label><span>Valve layer</span><select value={valveLayerId} onChange={(event) => setValveLayerId(event.target.value)} required>{valveLayers.map((layer) => <option value={layer.id} key={layer.id}>{layer.name}</option>)}</select></label>
              <label><span>Valve title</span><input name="title" required maxLength={140} defaultValue="Isolation valve" /></label>
              <label><span>Asset or reference number</span><input name="reference_code" maxLength={100} placeholder="Optional" /></label>
              <label><span>Notes</span><textarea name="description" maxLength={4_000} rows={3} placeholder="Valve size, position, access notes, or other field details" /></label>
              <div className="maps-coordinate-readout"><span>{pendingValveLocation.latitude.toFixed(7)}, {pendingValveLocation.longitude.toFixed(7)}</span><small>The saved valve will use the exact nearest point on the selected line.</small></div>
              <footer><button type="button" onClick={cancelValvePlacement}>Cancel</button><button type="submit" className="is-primary" disabled={saving}>{saving ? "Inserting…" : "Insert connected valve"}</button></footer>
            </form>
          </section>
        </div>
      )}

      {breakStartDialogOpen && pendingBreakLocation && (
        <div className="maps-dialog-backdrop" role="presentation">
          <section className="maps-dialog maps-incident-dialog" role="dialog" aria-modal="true" aria-labelledby="start-break-title">
            <header><div><span>ACTIVE INCIDENT</span><h2 id="start-break-title">Start water-main break</h2></div><button type="button" onClick={cancelBreakPlacement} aria-label="Close">×</button></header>
            <form onSubmit={(event) => void startBreakIncident(event)}>
              <div className="maps-incident-start-note"><strong>Start with what you know.</strong><span>This opens one continuing incident. Add updates here until the repair and testing are complete.</span></div>
              <label><span>Linked water line</span><input value={features.find((feature) => feature.id === pendingBreakLocation.featureId)?.title || "Selected water line"} disabled /></label>
              <label><span>Incident title</span><input name="title" required maxLength={180} defaultValue="Water-main break" /></label>
              <div className="maps-dialog-row"><label><span>Reported</span><input name="started_at" type="datetime-local" required defaultValue={localDateTimeValue()} /></label><label><span>Severity</span><select name="severity" defaultValue="urgent"><option value="attention">Needs attention</option><option value="urgent">Urgent</option><option value="emergency">Emergency</option></select></label></div>
              <label><span>What is known right now?</span><textarea name="initial_report" rows={4} maxLength={8_000} placeholder="Visible conditions, who reported it, immediate actions, or anything still unknown." /></label>
              <label><span>Estimated customers affected</span><input name="customers_affected_estimate" type="number" min="0" placeholder="Optional — this can be finalized when resolved" /></label>
              <div className="maps-dialog-row"><label><span>Customer/account reference</span><input name="customer_reference" maxLength={160} placeholder="Optional" /></label><label><span>Request reference</span><input name="request_reference" maxLength={160} placeholder="Optional" /></label></div>
              <div className="maps-coordinate-readout"><span>{pendingBreakLocation.latitude.toFixed(7)}, {pendingBreakLocation.longitude.toFixed(7)}</span><small>The point will snap to the selected line while preserving the reported coordinate.</small></div>
              <footer><button type="button" onClick={cancelBreakPlacement}>Cancel</button><button type="submit" className="is-danger-solid" disabled={saving}>{saving ? "Starting…" : "Start incident"}</button></footer>
            </form>
          </section>
        </div>
      )}

      {incidentUpdateDialogOpen && selectedIncident && (
        <div className="maps-dialog-backdrop" role="presentation">
          <section className="maps-dialog maps-incident-dialog" role="dialog" aria-modal="true" aria-labelledby="incident-update-title">
            <header><div><span>INC-{String(selectedIncident.incident_number).padStart(5, "0")}</span><h2 id="incident-update-title">Add incident update</h2></div><button type="button" onClick={() => setIncidentUpdateDialogOpen(false)} aria-label="Close">×</button></header>
            <form onSubmit={(event) => void addIncidentUpdate(event)}>
              <div className="maps-record-lock-note"><strong>One incident, permanent updates</strong><span>This update is added to the incident timeline and cannot be silently rewritten later.</span></div>
              <label><span>Update</span><select name="update_type" value={incidentUpdateType} onChange={(event) => chooseIncidentUpdateType(event.target.value as MapIncidentUpdate["update_type"])}>{INCIDENT_UPDATE_TYPES.map((type) => <option value={type.value} key={type.value}>{type.label}</option>)}</select></label>
              <div className="maps-dialog-row"><label><span>Incident status after update</span><select name="status_after" value={incidentUpdateStatus} onChange={(event) => setIncidentUpdateStatus(event.target.value as Exclude<MapIncidentStatus, "resolved">)}><option value="open">Open</option><option value="responding">Responding</option><option value="repairing">Repairing</option><option value="monitoring">Monitoring / testing</option></select></label><label><span>Occurred</span><input name="occurred_at" type="datetime-local" required defaultValue={localDateTimeValue()} /></label></div>
              <label><span>Update details</span><textarea name="note" rows={5} required maxLength={8_000} placeholder="What changed, what was completed, measurements, decisions, and what happens next." /></label>
              <footer><button type="button" onClick={() => setIncidentUpdateDialogOpen(false)}>Cancel</button><button type="submit" className="is-primary" disabled={saving}>{saving ? "Adding…" : "Add update"}</button></footer>
            </form>
          </section>
        </div>
      )}

      {incidentCloseDialogOpen && selectedIncident && (
        <div className="maps-dialog-backdrop" role="presentation">
          <section className="maps-dialog maps-event-dialog" role="dialog" aria-modal="true" aria-labelledby="close-break-title">
            <header><div><span>FINAL INCIDENT RECORD</span><h2 id="close-break-title">Resolve water-main break</h2></div><button type="button" onClick={() => setIncidentCloseDialogOpen(false)} aria-label="Close">×</button></header>
            <form onSubmit={(event) => void closeBreakIncident(event)}>
              <div className="maps-record-lock-note"><strong>Locked after closure</strong><span>Review the complete incident before closing it. Closure creates the immutable asset-history record.</span></div>
              <div className="maps-dialog-row"><label><span>Resolved</span><input name="resolved_at" type="datetime-local" required defaultValue={localDateTimeValue()} /></label><label><span>Final customers affected</span><input name="customers_affected_estimate" type="number" min="0" defaultValue={selectedIsolationEstimate?.customerReferences.length ?? selectedIncident.customers_affected_estimate ?? ""} /></label></div>
              <label><span>Confirmed cause</span><input name="cause" maxLength={1_000} placeholder="Freeze, material failure, excavation damage…" /></label>
              <label><span>Repair performed</span><input name="repair_method" maxLength={2_000} placeholder="Clamp, replaced section, coupling, valve work…" /></label>
              <div className="maps-event-checks"><label><input name="pressure_lost" type="checkbox" /> Positive pressure was lost</label><label><input name="disinfected" type="checkbox" /> Repair was disinfected</label><label><input name="sample_collected" type="checkbox" /> Verification sample collected</label></div>
              <div className="maps-dialog-row"><label><span>Chlorine residual</span><input name="chlorine_residual" placeholder="Value and unit" /></label><label><span>Sample result</span><input name="sample_result" placeholder="Pending, absent, report ID…" /></label></div>
              <label><span>Final incident summary</span><textarea name="summary" rows={5} required maxLength={8_000} placeholder="Summarize the response, repair, restoration, testing, customer impact, and any follow-up." /></label>
              <footer><button type="button" onClick={() => setIncidentCloseDialogOpen(false)}>Keep incident open</button><button type="submit" className="is-danger-solid" disabled={saving}>{saving ? "Closing…" : "Resolve and lock"}</button></footer>
            </form>
          </section>
        </div>
      )}

      {eventDialogOpen && selectedFeature && (
        <div className="maps-dialog-backdrop" role="presentation">
          <section className="maps-dialog maps-event-dialog" role="dialog" aria-modal="true" aria-labelledby="new-event-title">
            <header><div><span>PERMANENT HISTORY</span><h2 id="new-event-title">Record an event</h2></div><button type="button" onClick={() => setEventDialogOpen(false)} aria-label="Close">×</button></header>
            <form onSubmit={(event) => void saveEvent(event)}>
              <div className="maps-record-lock-note"><strong>Locked after submission</strong><span>Mistakes are corrected with an amendment so the original record is always preserved.</span></div>
              <label><span>Event type</span><select name="event_type" value={eventType} onChange={(event) => setEventType(event.target.value as MapEventType)}>{EVENT_TYPES.filter((type) => type.value !== "water_main_break").map((type) => <option value={type.value} key={type.value}>{type.label}</option>)}</select></label>
              <label><span>Title</span><input name="title" required maxLength={180} placeholder={EVENT_TYPES.find((type) => type.value === eventType)?.label || "Event title"} /></label>
              <div className="maps-dialog-row"><label><span>Occurred</span><input name="occurred_at" type="datetime-local" required defaultValue={localDateTimeValue()} /></label><label><span>Severity</span><select name="severity" defaultValue="routine"><option value="routine">Routine</option><option value="attention">Needs attention</option><option value="urgent">Urgent</option><option value="emergency">Emergency</option></select></label></div>

              {eventType === "water_main_break" && <fieldset className="maps-event-fields"><legend>Water-main response</legend><div className="maps-dialog-row"><label><span>Cause</span><input name="cause" placeholder="Unknown, freeze, material failure…" /></label><label><span>Customers affected</span><input name="customersAffected" type="number" min="0" /></label></div><label><span>Repair method</span><input name="repairMethod" placeholder="Clamp, replaced section, coupling…" /></label><div className="maps-event-checks"><label><input name="pressureLost" type="checkbox" /> Positive pressure was lost</label><label><input name="disinfected" type="checkbox" /> Repair was disinfected</label><label><input name="sampleCollected" type="checkbox" /> Verification sample collected</label></div><div className="maps-dialog-row"><label><span>Chlorine residual</span><input name="chlorineResidual" placeholder="Value and unit" /></label><label><span>Sample result</span><input name="sampleResult" placeholder="Pending, absent, report ID…" /></label></div></fieldset>}
              {eventType === "sewer_overflow" && <fieldset className="maps-event-fields"><legend>Overflow response</legend><div className="maps-dialog-row"><label><span>Estimated volume (gal)</span><input name="estimatedVolumeGallons" type="number" min="0" step="any" /></label><label><span>Estimate method</span><input name="volumeMethod" placeholder="Flow × duration…" /></label></div><label><span>Receiving water or affected area</span><input name="receivingWater" /></label><label><span>Cause or suspected cause</span><input name="cause" /></label><label><span>OERS incident number</span><input name="oersIncidentNumber" /></label><div className="maps-event-checks"><label><input name="contained" type="checkbox" /> Contained / stopped</label><label><input name="deqNotified" type="checkbox" /> DEQ/OERS notified</label></div><p>Reporting deadlines depend on the organization's current wastewater permit. This form preserves the information normally needed for the 24-hour notice and follow-up report.</p></fieldset>}
              {eventType === "valve_inspection" && <fieldset className="maps-event-fields"><legend>Valve inspection</legend><div className="maps-dialog-row"><label><span>Condition</span><select name="condition"><option value="good">Good</option><option value="fair">Fair</option><option value="poor">Poor</option><option value="failed">Failed</option></select></label><label><span>Normal position</span><select name="normalPosition"><option value="open">Open</option><option value="closed">Closed</option><option value="partial">Partially open</option></select></label></div><label><span>Turns to close</span><input name="turnsToClose" type="number" min="0" step="any" /></label><label><span>Repairs needed</span><input name="repairsNeeded" /></label><div className="maps-event-checks"><label><input name="operable" type="checkbox" /> Valve operated successfully</label></div></fieldset>}
              {eventType === "hydrant_inspection" && <fieldset className="maps-event-fields"><legend>Hydrant inspection</legend><div className="maps-dialog-row"><label><span>Condition</span><select name="condition"><option value="good">Good</option><option value="fair">Fair</option><option value="poor">Poor</option><option value="out_of_service">Out of service</option></select></label><label><span>Flow (GPM)</span><input name="flowGpm" type="number" min="0" step="any" /></label></div><div className="maps-dialog-row"><label><span>Static pressure</span><input name="staticPressure" placeholder="psi" /></label><label><span>Residual pressure</span><input name="residualPressure" placeholder="psi" /></label></div><label><span>Repairs needed</span><input name="repairsNeeded" /></label><div className="maps-event-checks"><label><input name="drainsProperly" type="checkbox" /> Barrel drains properly</label><label><input name="flushed" type="checkbox" /> Hydrant flushed</label></div></fieldset>}

              <label><span>What happened</span><textarea name="summary" maxLength={8_000} rows={4} placeholder="Document findings, actions, measurements, and follow-up." /></label>
              <div className="maps-dialog-row"><label><span>Customer/account reference</span><input name="customer_reference" maxLength={160} defaultValue={selectedFeature.customer_reference || ""} placeholder="Optional" /></label><label><span>Request reference</span><input name="request_reference" maxLength={160} placeholder="Optional — ready for future requests" /></label></div>
              <label className="maps-check-row"><input name="resolved" type="checkbox" /><span>Mark this event resolved</span></label>
              <footer><button type="button" onClick={() => setEventDialogOpen(false)}>Cancel</button><button type="submit" className="is-primary" disabled={saving}>{saving ? "Submitting…" : "Submit permanent event"}</button></footer>
            </form>
          </section>
        </div>
      )}

      {taskDialogOpen && selectedFeature && (
        <div className="maps-dialog-backdrop" role="presentation">
          <section className="maps-dialog" role="dialog" aria-modal="true" aria-labelledby="new-task-title">
            <header><div><span>UPCOMING WORK</span><h2 id="new-task-title">Add a task</h2></div><button type="button" onClick={() => setTaskDialogOpen(false)} aria-label="Close">×</button></header>
            <form onSubmit={(event) => void saveTask(event)}>
              <label><span>Task</span><input name="title" required maxLength={180} placeholder="Inspect, test, repair, report…" /></label>
              <div className="maps-dialog-row"><label><span>Category</span><select name="category" defaultValue="maintenance"><option value="inspection">Inspection</option><option value="maintenance">Maintenance</option><option value="repair">Repair</option><option value="testing">Testing</option><option value="sampling">Sampling</option><option value="reporting">Reporting</option><option value="customer_request">Customer request</option><option value="follow_up">Follow-up</option></select></label><label><span>Priority</span><select name="priority" defaultValue="normal"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label></div>
              <div className="maps-dialog-row"><label><span>Due date</span><input name="due_at" type="datetime-local" /></label><label><span>Basis</span><select name="compliance_basis" defaultValue="operational"><option value="operational">Operational</option><option value="recommended">Recommended practice</option><option value="organization_policy">Organization policy</option><option value="rule">Rule requirement</option><option value="permit">Permit requirement</option></select></label></div>
              <label><span>Instructions</span><textarea name="description" maxLength={8_000} rows={4} placeholder="What needs to be checked or completed?" /></label>
              <div className="maps-dialog-row"><label><span>Customer/account reference</span><input name="customer_reference" maxLength={160} defaultValue={selectedFeature.customer_reference || ""} placeholder="Optional" /></label><label><span>Request reference</span><input name="request_reference" maxLength={160} placeholder="Optional — ready for future requests" /></label></div>
              <p>Completing this task will automatically create a permanent history event for {selectedFeature.title}.</p>
              <footer><button type="button" onClick={() => setTaskDialogOpen(false)}>Cancel</button><button type="submit" className="is-primary" disabled={saving}>{saving ? "Saving…" : "Add task"}</button></footer>
            </form>
          </section>
        </div>
      )}

      {taskCompleting && selectedFeature && (
        <div className="maps-dialog-backdrop maps-dialog-backdrop-front" role="presentation">
          <section className="maps-dialog maps-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="complete-task-title">
            <header><div><span>COMPLETE TASK</span><h2 id="complete-task-title">{taskCompleting.title}</h2></div><button type="button" onClick={() => setTaskCompleting(null)} aria-label="Close">×</button></header>
            <form onSubmit={(event) => void completeTask(event)}><div className="maps-record-lock-note"><strong>Creates permanent history</strong><span>The completion record will be locked after submission.</span></div><label><span>Completion summary</span><textarea name="completion_summary" rows={4} maxLength={8_000} required placeholder="Document what was completed, findings, and any follow-up needed." /></label><footer><button type="button" onClick={() => setTaskCompleting(null)}>Cancel</button><button type="submit" className="is-primary" disabled={saving}>{saving ? "Completing…" : "Complete and record"}</button></footer></form>
          </section>
        </div>
      )}

      {featureEditOpen && selectedFeature && (
        <div className="maps-dialog-backdrop" role="presentation">
          <section className="maps-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-feature-title">
            <header><div><span>MAPPED ITEM</span><h2 id="edit-feature-title">Edit item details</h2></div><button type="button" onClick={() => setFeatureEditOpen(false)} aria-label="Close">×</button></header>
            <form onSubmit={(event) => void saveFeatureDetails(event)}>
              <label><span>Layer</span><input value={selectedLayer?.name || "Mapped item"} disabled /></label>
              <label><span>Title</span><input name="title" required maxLength={140} defaultValue={selectedFeature.title} /></label>
              <label><span>Asset or reference number</span><input name="reference_code" maxLength={100} defaultValue={selectedFeature.reference_code || ""} placeholder="Optional" /></label>
              <label><span>Address or location description</span><input name="address" maxLength={500} defaultValue={selectedFeature.address || ""} placeholder="Optional" /></label>
              <label><span>Customer/account reference</span><input name="customer_reference" maxLength={160} defaultValue={selectedFeature.customer_reference || ""} placeholder="Optional — does not connect a customer account yet" /></label>
              <label><span>Status</span><select name="status" defaultValue={selectedFeature.status}><option value="active">Active</option><option value="inactive">Inactive</option><option value="unknown">Unknown</option></select></label>
              {selectedFields.map((field) => <label key={field.id}><span>{field.label}{field.is_required ? " *" : ""}</span>{field.field_type === "select" ? <select name={`custom_${field.field_key}`} required={field.is_required} defaultValue={String(selectedFeature.properties?.[field.field_key] ?? "")}><option value="">Select…</option>{field.options.map((option) => <option value={option} key={option}>{option}</option>)}</select> : field.field_type === "boolean" ? <input name={`custom_${field.field_key}`} type="checkbox" defaultChecked={Boolean(selectedFeature.properties?.[field.field_key])} /> : <input name={`custom_${field.field_key}`} type={field.field_type === "number" ? "number" : field.field_type === "date" ? "date" : "text"} required={field.is_required} defaultValue={String(selectedFeature.properties?.[field.field_key] ?? "")} />}</label>)}
              <label><span>Notes</span><textarea name="description" maxLength={4_000} rows={4} defaultValue={selectedFeature.description || ""} placeholder="Optional field notes" /></label>
              <p>This changes the item details without moving its mapped location.</p>
              <footer><button type="button" onClick={() => setFeatureEditOpen(false)}>Cancel</button><button type="submit" className="is-primary" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button></footer>
            </form>
          </section>
        </div>
      )}

      {featureDeleteOpen && selectedFeature && (
        <div className="maps-dialog-backdrop" role="presentation">
          <section className="maps-dialog maps-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-feature-title">
            <header><div><span>MAPPED ITEM</span><h2 id="delete-feature-title">Delete {selectedFeature.title}?</h2></div><button type="button" onClick={() => setFeatureDeleteOpen(false)} aria-label="Close">×</button></header>
            <div className="maps-confirm-copy"><p>This removes the item from the map and the map library. Its saved record is archived so it can be recovered later.</p></div>
            <footer><button type="button" onClick={() => setFeatureDeleteOpen(false)}>Cancel</button><button type="button" className="is-danger" disabled={saving} onClick={() => void archiveFeature()}>{saving ? "Deleting…" : "Delete item"}</button></footer>
          </section>
        </div>
      )}

      {proposedMove && movingFeatureId && selectedFeature && (
        <div className="maps-dialog-backdrop" role="presentation">
          <section className="maps-dialog maps-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="move-feature-title">
            <header><div><span>NEW POSITION</span><h2 id="move-feature-title">Move {selectedFeature.title} here?</h2></div><button type="button" onClick={cancelMoveFeature} aria-label="Close">×</button></header>
            <div className="maps-confirm-copy maps-move-confirmation">
              <p>Review the new position before replacing the saved location.</p>
              <div className="maps-coordinate-readout"><span>{proposedMove.latitude.toFixed(7)}, {proposedMove.longitude.toFixed(7)}</span><small>{proposedMove.accuracyMeters === null ? "Selected on map" : `GPS accuracy ±${Math.round(proposedMove.accuracyMeters * 3.28084)} ft`}</small></div>
            </div>
            <footer><button type="button" onClick={cancelMoveFeature}>Keep original</button><button type="button" className="is-primary" disabled={saving} onClick={() => void saveMovedFeature()}>{saving ? "Saving…" : "Save new location"}</button></footer>
          </section>
        </div>
      )}

      {toast && <div className="maps-toast" role="status">{toast}</div>}
    </div>
  );
}
