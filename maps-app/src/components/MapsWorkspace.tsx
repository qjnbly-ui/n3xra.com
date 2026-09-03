import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import mapboxgl, { GeoJSONSource, Map as MapboxMap, Marker } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  DeviceLocation,
  GeometryType,
  MapFeature,
  MapFeaturePhoto,
  MapLayer,
  MapLayerField,
  MapWorkspaceSnapshot,
  OrganizationAccess,
} from "../lib/maps-types";

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

type GateState = "loading" | "signed-out" | "unassigned" | "setup" | "ready" | "error";
type BasemapStyle = "standard" | "satellite";
type ActivationMode = "existing" | "new";

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
const DRAFT_SHAPE_SOURCE_ID = "maps-draft-shape";
const DRAFT_SHAPE_FILL_ID = "maps-draft-shape-fill";
const DRAFT_SHAPE_CASING_ID = "maps-draft-shape-casing";
const DRAFT_SHAPE_LINE_ID = "maps-draft-shape-line";
const DRAFT_SHAPE_VERTICES_ID = "maps-draft-shape-vertices";

function pointCoordinates(feature: MapFeature): [number, number] | null {
  if (feature.geometry.type !== "Point" || !Array.isArray(feature.geometry.coordinates)) return null;
  const [longitude, latitude] = feature.geometry.coordinates as unknown[];
  if (typeof longitude !== "number" || typeof latitude !== "number") return null;
  return [longitude, latitude];
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

function layerIcon(layer: Pick<MapLayer, "icon_key" | "name"> | undefined): string {
  if (!layer) return "•";
  const icons: Record<string, string> = {
    meter: "M",
    valve: "V",
    hydrant: "H",
    pump: "P",
    manhole: "S",
    boundary: "◇",
  };
  return icons[layer.icon_key] || layer.name.slice(0, 1).toUpperCase() || "•";
}

export default function MapsWorkspace({ mapboxToken }: MapsWorkspaceProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const featureMarkersRef = useRef<Map<string, Marker>>(new Map());
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
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [gate, setGate] = useState<GateState>("loading");
  const [gateMessage, setGateMessage] = useState("Opening your maps workspace…");
  const [accessList, setAccessList] = useState<OrganizationAccess[]>([]);
  const [activeAccess, setActiveAccess] = useState<OrganizationAccess | null>(null);
  const [layers, setLayers] = useState<MapLayer[]>([]);
  const [features, setFeatures] = useState<MapFeature[]>([]);
  const [layerFields, setLayerFields] = useState<MapLayerField[]>([]);
  const [featurePhotos, setFeaturePhotos] = useState<MapFeaturePhoto[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [layerFieldDrafts, setLayerFieldDrafts] = useState<LayerFieldDraft[]>([]);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [visibleLayers, setVisibleLayers] = useState<Record<string, boolean>>({});
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [selectedLayerId, setSelectedLayerId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [basemap, setBasemap] = useState<BasemapStyle>("standard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [layerDialogOpen, setLayerDialogOpen] = useState(false);
  const [editingLayer, setEditingLayer] = useState<MapLayer | null>(null);
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
  const [shapeDraft, setShapeDraft] = useState<ShapeDraft | null>(null);
  const [pendingShape, setPendingShape] = useState<ShapeDraft | null>(null);
  const [shapeHoverCoordinate, setShapeHoverCoordinate] = useState<[number, number] | null>(null);
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

  const canEdit = activeAccess?.role === "account_admin" || activeAccess?.role === "editor";
  const canPermanentlyDelete = activeAccess?.role === "account_admin";
  const selectedFeature = features.find((feature) => feature.id === selectedFeatureId) || null;
  const selectedLayer = layers.find((layer) => layer.id === selectedFeature?.layer_id);
  const selectedDistance = selectedFeature && deviceLocation ? metersBetween(deviceLocation, selectedFeature) : null;
  const directionsTarget = features.find((feature) => feature.id === directionsTargetId) || null;
  const selectedFields = layerFields.filter((field) => field.layer_id === selectedFeature?.layer_id);
  const selectedPhotos = featurePhotos.filter((photo) => photo.feature_id === selectedFeatureId);
  const activeDrawingLayer = layers.find((layer) => layer.id === selectedLayerId && layer.is_editable) || null;

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
    setGate("loading");
    setGateMessage("Loading map layers and assets…");
    const [workspaceResult, fieldsResult, photosResult] = await Promise.all([
      supabase.rpc("maps_workspace_snapshot", { input_organization_id: access.organizationId }),
      supabase.from("map_layer_fields").select("id, organization_id, layer_id, field_key, label, field_type, options, is_required, sort_order").eq("organization_id", access.organizationId).order("sort_order"),
      supabase.from("map_feature_photos").select("id, organization_id, feature_id, storage_path, caption, mime_type, size_bytes, created_at").eq("organization_id", access.organizationId).order("created_at", { ascending: false }),
    ]);
    if (workspaceResult.error || fieldsResult.error || photosResult.error) throw workspaceResult.error || fieldsResult.error || photosResult.error;
    const snapshot = workspaceResult.data as unknown as MapWorkspaceSnapshot;
    const nextLayers = Array.isArray(snapshot.layers) ? snapshot.layers : [];
    const nextFeatures = Array.isArray(snapshot.features) ? snapshot.features : [];
    setLayers(nextLayers);
    setFeatures(nextFeatures);
    setLayerFields((fieldsResult.data || []) as MapLayerField[]);
    setFeaturePhotos((photosResult.data || []) as MapFeaturePhoto[]);
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
    if (!map) return;
    map.setStyle(basemap === "satellite" ? SATELLITE_STYLE : STANDARD_STYLE);
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
      button.className = `maps-marker${selectedFeatureId === feature.id ? " is-selected" : ""}${isMoving ? " is-moving" : ""}`;
      button.style.setProperty("--marker-color", layer?.color || "#1ed7b2");
      const label = document.createElement("span");
      label.textContent = layerIcon(layer);
      button.append(label);
      button.setAttribute("aria-label", `Open ${feature.title}`);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        setSelectedFeatureId(feature.id);
        setSidebarOpen(false);
      });
      const marker = new mapboxgl.Marker({
        element: button,
        anchor: "bottom",
        offset: [0, -7],
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
  }, [features, layers, movingFeatureId, selectedFeatureId, visibleLayers]);

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
            "line-color": ["get", "color"],
            "line-width": ["case", ["get", "selected"], 7, 4],
            "line-opacity": ["case", ["get", "selected"], 1, ["get", "opacity"]],
          },
          layout: { "line-cap": "round", "line-join": "round" },
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
  }, [basemap, editingShapeId, features, layers, mapReady, selectedFeatureId, shapeDraft, visibleLayers]);

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
    };
    if (map.isStyleLoaded()) render();
    else map.once("style.load", render);
    return () => {
      map.off("style.load", render);
    };
  }, [basemap, layers, mapReady, pendingShape, shapeDraft, shapeHoverCoordinate]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || shapeDraft || pendingShape) return;
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
        setShapeDraft((current) => current ? {
          ...current,
          coordinates: current.coordinates.map((item, itemIndex) => itemIndex === index ? [next.lng, next.lat] : item),
        } : current);
      });
      return marker;
    });
    shapeVertexMarkersRef.current = markers;
    return () => {
      markers.forEach((marker) => marker.remove());
      if (shapeVertexMarkersRef.current === markers) shapeVertexMarkersRef.current = [];
    };
  }, [editingShapeId, selectedShapeVertexIndex, shapeDraft]);

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
    if (!map || !shapeDraft) return;
    const handleShapeMove = (event: mapboxgl.MapMouseEvent) => setShapeHoverCoordinate([event.lngLat.lng, event.lngLat.lat]);
    const handleShapeLeave = () => setShapeHoverCoordinate(null);
    const handleShapeClick = (event: mapboxgl.MapMouseEvent) => {
      setShapeHoverCoordinate(null);
      setShapeDraft((current) => current ? {
        ...current,
        coordinates: (() => {
          if (editingShapeId) setShapeEditHistory((history) => [...history, current.coordinates]);
          const next = [...current.coordinates, [event.lngLat.lng, event.lngLat.lat] as [number, number]];
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
    };
  }, [editingShapeId, shapeDraft?.layerId, shapeDraft?.geometryType]);

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
    try {
      await loadWorkspace(client, access);
    } catch (error) {
      console.warn("The selected maps workspace could not be loaded.", error);
      setGate("error");
      setGateMessage("That maps workspace could not be loaded.");
    }
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
    if (!client || !activeAccess || !canEdit) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    const geometryType = String(form.get("geometry_type") || "point") as GeometryType;
    if (!name) return;
    setSaving(true);
    const { error } = await client.from("map_layers").insert({
      organization_id: activeAccess.organizationId,
      name,
      description: String(form.get("description") || "").trim() || null,
      geometry_type: geometryType,
      feature_kind: geometryType === "point" ? "asset" : "reference",
      icon_key: String(form.get("icon_key") || "marker"),
      color: String(form.get("color") || "#1ed7b2"),
      fill_color: String(form.get("color") || "#1ed7b2"),
      is_editable: true,
    });
    setSaving(false);
    if (error) {
      showToast(error.message);
      return;
    }
    setLayerDialogOpen(false);
    await loadWorkspace(client, activeAccess);
    showToast("Layer created");
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
    setSaving(false);
    if (detailResult.error) {
      showToast(`Location saved, but its asset details need attention: ${detailResult.error.message}`);
    }
    setFeatureDialogOpen(false);
    setPendingPoint(null);
    await loadWorkspace(client, activeAccess);
    setSelectedFeatureId(featureId);
    showToast("Location saved");
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
    setSaving(false);
    if (detailResult.error) showToast(`Shape saved, but its details need attention: ${detailResult.error.message}`);
    setPendingShape(null);
    await loadWorkspace(client, activeAccess);
    setSelectedFeatureId(featureId);
    showToast(pendingShape.geometryType === "line" ? "Line saved" : "Boundary saved");
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
    setEditingLayer(layer);
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
    if (!client || !activeAccess || !editingLayer || !canEdit) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    if (!name) return;
    setSaving(true);
    const { data, error } = await client
      .from("map_layers")
      .update({
        name,
        description: String(form.get("description") || "").trim() || null,
        icon_key: String(form.get("icon_key") || "marker"),
        color: String(form.get("color") || "#1ed7b2"),
        fill_color: String(form.get("color") || "#1ed7b2"),
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
    if (!client || !activeAccess || !editingLayer || !canEdit) return;
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
    if (!client || !activeAccess || !canEdit) return;
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
    const table = permanentDeleteTarget.type === "layer" ? "map_layers" : "map_features";
    setSaving(true);
    const { data, error } = await client
      .from(table)
      .delete()
      .eq("id", permanentDeleteTarget.id)
      .eq("organization_id", activeAccess.organizationId)
      .not("archived_at", "is", null)
      .select("id")
      .single();
    setSaving(false);
    if (error || !data) {
      showToast(error?.message || "That archived item could not be permanently deleted.");
      return;
    }
    setPermanentDeleteTarget(null);
    await loadArchive(client, activeAccess);
    showToast("Archived item permanently deleted");
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
    showToast("Point location updated");
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
    setSelectedFeatureId(null);
    if (activeDrawingLayer.geometry_type === "point") {
      setPlacementMode(true);
      showToast("Click the map to place the asset.");
      return;
    }
    if (activeDrawingLayer.geometry_type === "line" || activeDrawingLayer.geometry_type === "polygon") {
      setShapeHoverCoordinate(null);
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
    setSelectedShapeVertexIndex(null);
    setShapeEditHistory([]);
    setShapeEditReview(false);
    showToast("Drag a point, select one to remove it, or click the map to add a point.");
  };

  const undoShapeVertex = () => {
    if (!editingShapeId) {
      setShapeDraft((current) => current ? { ...current, coordinates: current.coordinates.slice(0, -1) } : current);
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
    setEditingShapeId(null);
    setSelectedShapeVertexIndex(null);
    setShapeEditHistory([]);
    setShapeEditReview(false);
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
          <a href="/client-portal/">Dashboard</a>
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

          <section className="maps-layers">
            <header><div><span>Layers</span><small>{layers.length}</small></div>{canEdit && <div className="maps-layer-header-actions"><button type="button" className="maps-archive-button" onClick={openArchive}>Archive</button><button type="button" className="maps-add-layer-button" onClick={() => setLayerDialogOpen(true)} aria-label="Create layer">＋</button></div>}</header>
            {layers.length ? layers.map((layer) => (
              <div className="maps-layer-row" key={layer.id}>
                <label className="maps-layer">
                  <input type="checkbox" checked={visibleLayers[layer.id] !== false} onChange={() => toggleLayer(layer.id)} />
                  <i style={{ background: layer.color }}>{layerIcon(layer)}</i>
                  <span><strong>{layer.name}</strong><small>{layer.geometry_type} · {features.filter((feature) => feature.layer_id === layer.id).length} items</small></span>
                  {layer.geometry_type !== "raster" && layer.is_editable && canEdit && (
                    <input className="maps-layer-radio" type="radio" name="active-layer" checked={selectedLayerId === layer.id} onChange={() => setSelectedLayerId(layer.id)} aria-label={`Draw in ${layer.name}`} />
                  )}
                </label>
                {canEdit && <button type="button" className="maps-layer-settings" onClick={() => openLayerEditor(layer)} aria-label={`Edit ${layer.name} layer`}>•••</button>}
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
                return (
                  <button type="button" className={selectedFeatureId === feature.id ? "is-selected" : ""} key={feature.id} onClick={() => { setSelectedFeatureId(feature.id); setSidebarOpen(false); }}>
                    <i style={{ background: layer?.color || "#1ed7b2" }}>{layerIcon(layer)}</i>
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
              {gate === "unassigned" && <a href="/account/#available-apps-section">Return to dashboard</a>}
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
          </div>

          {gate === "ready" && !navigationActive && (
            <div className="maps-field-tools">
              {shapeDraft ? (
                <><button type="button" onClick={cancelShapeDrawing}>× <span>{editingShapeId ? "Discard" : "Cancel"}</span></button><button type="button" onClick={undoShapeVertex} disabled={editingShapeId ? !shapeEditHistory.length : !shapeDraft.coordinates.length}>↶ <span>Undo</span></button>{editingShapeId && <button type="button" onClick={removeSelectedShapeVertex} disabled={selectedShapeVertexIndex === null}>− <span>Remove point</span></button>}<button type="button" className="is-active" onClick={finishShapeDrawing}>✓ <span>{editingShapeId ? "Review" : shapeDraft.geometryType === "line" ? "Finish line" : "Finish boundary"}</span></button></>
              ) : movingFeatureId ? (
                <><button type="button" onClick={cancelMoveFeature}>× <span>Cancel move</span></button><button type="button" onClick={proposeMoveFromGps}>◎ <span>{deviceLocation ? "Use GPS" : "Locate me"}</span></button></>
              ) : (
                <><button type="button" onClick={locating ? () => stopLocating() : startLocating} className={deviceLocation ? "is-active" : ""} title={locating ? "Cancel location search" : "Find my location"}>◎ <span>{locating ? "Cancel" : deviceLocation ? "Center on me" : "Locate me"}</span></button>{canEdit && activeDrawingLayer && <button type="button" onClick={beginManualPlacement} className={placementMode ? "is-active" : ""}>＋ <span>{placementMode ? "Click map…" : activeDrawingLayer.geometry_type === "line" ? "Draw line" : activeDrawingLayer.geometry_type === "polygon" ? "Draw boundary" : "Place pin"}</span></button>}{canEdit && activeDrawingLayer?.geometry_type === "point" && <button type="button" onClick={placeAtCurrentLocation}>⌖ <span>Pin here</span></button>}</>
              )}
            </div>
          )}

          {movingFeatureId && !proposedMove && <div className="maps-move-banner"><strong>Move point</strong><span>Drag the selected point or click its new position.</span></div>}
          {shapeDraft && <div className="maps-move-banner maps-drawing-banner"><strong>{editingShapeId ? `Editing ${shapeDraft.geometryType === "line" ? "line" : "boundary"}` : shapeDraft.geometryType === "line" ? "Drawing line" : "Drawing boundary"}</strong><span>{editingShapeId ? "Drag points · select a point to remove · click map to add" : `${shapeDraft.coordinates.length} point${shapeDraft.coordinates.length === 1 ? "" : "s"} added · click the map to continue`}</span></div>}

          {locationError && <p className={`maps-location-error${locating ? " is-waiting" : ""}`} role="status">{locationError}</p>}

          {selectedFeature && !movingFeatureId && !editingShapeId && !directionsTargetId && (
            <article className="maps-detail-card">
              <button type="button" className="maps-detail-close" onClick={() => setSelectedFeatureId(null)} aria-label="Close mapped item">×</button>
              <div className="maps-detail-icon" style={{ background: selectedLayer?.color || "#1ed7b2" }}>{layerIcon(selectedLayer)}</div>
              <div className="maps-detail-title"><span>{selectedLayer?.name || "Mapped item"}</span><h2>{selectedFeature.title}</h2>{selectedFeature.reference_code && <p>{selectedFeature.reference_code}</p>}</div>
              {selectedFeature.description && <p className="maps-detail-description">{selectedFeature.description}</p>}
              <div className="maps-detail-actions">{selectedFeature.geometry_type === "point" && <button type="button" className="maps-detail-directions" onClick={() => startDirections(selectedFeature)}>Directions</button>}{canEdit && <><button type="button" className="maps-detail-edit" onClick={() => setFeatureEditOpen(true)}>Edit item</button>{selectedFeature.geometry_type === "point" ? <button type="button" className="maps-detail-move" onClick={beginMoveFeature}>Move point</button> : <button type="button" className="maps-detail-move" onClick={beginShapeEdit}>Edit shape</button>}<button type="button" className="maps-detail-delete" onClick={() => setFeatureDeleteOpen(true)}>Delete item</button></>}</div>
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
              <section className="maps-asset-photos">
                <header><span>PHOTOS</span>{canEdit && <label className={photoUploading ? "is-disabled" : ""}>＋ Add photo<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" disabled={photoUploading} onChange={(event) => void uploadFeaturePhoto(event)} /></label>}</header>
                {selectedPhotos.length ? <div>{selectedPhotos.map((photo) => <figure key={photo.id}>{photoUrls[photo.id] ? <img src={photoUrls[photo.id]} alt={photo.caption || selectedFeature.title} /> : <span>Loading…</span>}<figcaption>{photo.caption || "Asset photo"}</figcaption>{canEdit && <button type="button" disabled={photoUploading} onClick={() => void deleteFeaturePhoto(photo)} aria-label={`Delete ${photo.caption || "asset photo"}`}>×</button>}</figure>)}</div> : <p>No photos added yet.</p>}
              </section>
              {selectedFeature.geometry_type === "point" && <div className="maps-proximity">
                <span>FIELD LOCATION</span>
                <strong>{selectedDistance === null ? "Start locating to measure distance" : formatDistance(selectedDistance)}</strong>
                <small>{deviceLocation ? `Current GPS accuracy ±${Math.round(deviceLocation.accuracyMeters * 3.28084)} ft` : "Your device will report its current accuracy."}</small>
                <button type="button" onClick={locating ? () => stopLocating() : startLocating}>{locating ? "Cancel location search" : deviceLocation ? "Center on me" : "Use my location"}</button>
              </div>}
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

      {layerDialogOpen && (
        <div className="maps-dialog-backdrop" role="presentation">
          <section className="maps-dialog" role="dialog" aria-modal="true" aria-labelledby="new-layer-title">
            <header><div><span>MAP STRUCTURE</span><h2 id="new-layer-title">Create a layer</h2></div><button type="button" onClick={() => setLayerDialogOpen(false)} aria-label="Close">×</button></header>
            <form onSubmit={(event) => void saveLayer(event)}>
              <label><span>Layer name</span><input name="name" required maxLength={100} placeholder="Meters, valves, district boundary…" /></label>
              <label><span>Description</span><input name="description" maxLength={180} placeholder="Optional" /></label>
              <div className="maps-form-grid">
                <label><span>Geometry</span><select name="geometry_type"><option value="point">Points</option><option value="line">Lines</option><option value="polygon">Polygons</option><option value="raster">Map overlay</option></select></label>
                <label><span>Marker</span><select name="icon_key"><option value="marker">Marker</option><option value="meter">Meter</option><option value="valve">Valve</option><option value="hydrant">Hydrant</option><option value="pump">Pump</option><option value="manhole">Manhole</option><option value="boundary">Boundary</option></select></label>
                <label><span>Color</span><input name="color" type="color" defaultValue="#1ed7b2" /></label>
              </div>
              <p>Point, line, and polygon layers can be drawn directly on the map. Raster overlays will use the upcoming import tools.</p>
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
              <div className="maps-form-grid maps-layer-edit-grid">
                <label><span>Geometry</span><input value={editingLayer.geometry_type} disabled /></label>
                <label><span>Marker</span><select name="icon_key" defaultValue={editingLayer.icon_key}><option value="marker">Marker</option><option value="meter">Meter</option><option value="valve">Valve</option><option value="hydrant">Hydrant</option><option value="pump">Pump</option><option value="manhole">Manhole</option><option value="boundary">Boundary</option></select></label>
                <label><span>Color</span><input name="color" type="color" defaultValue={editingLayer.color} /></label>
              </div>
              <label className="maps-check-row"><input name="is_visible_by_default" type="checkbox" defaultChecked={editingLayer.is_visible_by_default} /><span>Show this layer by default</span></label>
              <section className="maps-custom-fields-editor">
                <header><div><strong>Custom asset fields</strong><span>These fields appear on every item in this layer.</span></div><button type="button" onClick={addLayerFieldDraft}>＋ Add field</button></header>
                {layerFieldDrafts.length ? <div>{layerFieldDrafts.map((field, index) => <article key={field.id || `new-${index}`}>
                  <input aria-label={`Custom field ${index + 1} label`} value={field.label} onChange={(event) => setLayerFieldDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))} placeholder="Field name" maxLength={100} required />
                  <select aria-label={`Custom field ${index + 1} type`} value={field.fieldType} onChange={(event) => setLayerFieldDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, fieldType: event.target.value as LayerFieldDraft["fieldType"] } : item))}><option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="boolean">Yes / No</option><option value="select">Choice list</option></select>
                  <label><input type="checkbox" checked={field.isRequired} onChange={(event) => setLayerFieldDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, isRequired: event.target.checked } : item))} /><span>Required</span></label>
                  <button type="button" className="is-remove" onClick={() => setLayerFieldDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${field.label || `custom field ${index + 1}`}`}>×</button>
                  {field.fieldType === "select" && <input className="maps-custom-field-options" value={field.optionsText} onChange={(event) => setLayerFieldDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, optionsText: event.target.value } : item))} placeholder="Choices separated by commas" />}
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
                      <i style={{ background: layer.color }}>{layerIcon(layer)}</i>
                      <span><strong>{layer.name}</strong><small>Layer · {archivedFeatures.filter((feature) => feature.layer_id === layer.id).length} mapped items</small></span>
                      <div><button type="button" onClick={() => void restoreArchivedLayer(layer.id)} disabled={saving}>Restore</button>{canPermanentlyDelete && <button type="button" className="is-delete" onClick={() => setPermanentDeleteTarget({ type: "layer", id: layer.id, name: layer.name })}>Delete</button>}</div>
                    </article>
                  ))}
                  {archivedFeatures.filter((feature) => !archivedLayers.some((layer) => layer.id === feature.layer_id)).map((feature) => (
                    <article className="maps-archive-item" key={`feature-${feature.id}`}>
                      <i>{layerIcon(layers.find((layer) => layer.id === feature.layer_id))}</i>
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
            <div className="maps-confirm-copy"><p>This cannot be undone. {permanentDeleteTarget.type === "layer" ? "The layer and every mapped item inside it will be permanently removed." : "The mapped item will be permanently removed."}</p></div>
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
