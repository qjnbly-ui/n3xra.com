import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import mapboxgl, { Map as MapboxMap, Marker } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  DeviceLocation,
  GeometryType,
  MapFeature,
  MapLayer,
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

type GateState = "loading" | "signed-out" | "unassigned" | "setup" | "ready" | "error";
type BasemapStyle = "standard" | "satellite";
type ActivationMode = "existing" | "new";

const ACTIVE_ORGANIZATION_KEY = "records-active-organization-id";
const STANDARD_STYLE = "mapbox://styles/mapbox/standard";
const SATELLITE_STYLE = "mapbox://styles/mapbox/satellite-streets-v12";

function pointCoordinates(feature: MapFeature): [number, number] | null {
  if (feature.geometry.type !== "Point" || !Array.isArray(feature.geometry.coordinates)) return null;
  const [longitude, latitude] = feature.geometry.coordinates as unknown[];
  if (typeof longitude !== "number" || typeof latitude !== "number") return null;
  return [longitude, latitude];
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
  const locationMarkerRef = useRef<Marker | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const locationRequestTimerRef = useRef<number | null>(null);
  const locationRequestIdRef = useRef(0);
  const fittedOrganizationRef = useRef<string | null>(null);
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [gate, setGate] = useState<GateState>("loading");
  const [gateMessage, setGateMessage] = useState("Opening your maps workspace…");
  const [accessList, setAccessList] = useState<OrganizationAccess[]>([]);
  const [activeAccess, setActiveAccess] = useState<OrganizationAccess | null>(null);
  const [layers, setLayers] = useState<MapLayer[]>([]);
  const [features, setFeatures] = useState<MapFeature[]>([]);
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
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [deviceLocation, setDeviceLocation] = useState<DeviceLocation | null>(null);
  const [locationError, setLocationError] = useState("");
  const [locating, setLocating] = useState(false);
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

  const filteredFeatures = useMemo(() => {
    const query = search.trim().toLowerCase();
    return features
      .filter((feature) => visibleLayers[feature.layer_id] !== false)
      .filter((feature) => {
        if (!query) return true;
        const layer = layers.find((item) => item.id === feature.layer_id);
        return [feature.title, feature.reference_code || "", feature.description || "", layer?.name || ""]
          .some((value) => value.toLowerCase().includes(query));
      })
      .sort((left, right) => left.title.localeCompare(right.title));
  }, [features, layers, search, visibleLayers]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3_000);
  }, []);

  const loadWorkspace = useCallback(async (supabase: SupabaseClient, access: OrganizationAccess) => {
    setGate("loading");
    setGateMessage("Loading map layers and assets…");
    const { data, error } = await supabase.rpc("maps_workspace_snapshot", {
      input_organization_id: access.organizationId,
    });
    if (error) throw error;
    const snapshot = data as unknown as MapWorkspaceSnapshot;
    const nextLayers = Array.isArray(snapshot.layers) ? snapshot.layers : [];
    const nextFeatures = Array.isArray(snapshot.features) ? snapshot.features : [];
    setLayers(nextLayers);
    setFeatures(nextFeatures);
    setVisibleLayers(Object.fromEntries(nextLayers.map((layer) => [layer.id, layer.is_visible_by_default])));
    setSelectedLayerId((current) => nextLayers.some((layer) => layer.id === current)
      ? current
      : nextLayers.find((layer) => layer.geometry_type === "point" && layer.is_editable)?.id || "");
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
      const marker = new mapboxgl.Marker({ element: button, anchor: "bottom", draggable: isMoving })
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
    const organizationId = activeAccess?.organizationId;
    if (!map || !mapReady || !organizationId || fittedOrganizationRef.current === organizationId) return;
    const coordinates = features.map(pointCoordinates).filter((point): point is [number, number] => point !== null);
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
    const coordinates = pointCoordinates(selectedFeature);
    if (coordinates) map.easeTo({ center: coordinates, zoom: Math.max(map.getZoom(), 17), duration: 650 });
  }, [selectedFeature]);

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
    setSaving(false);
    if (error) {
      showToast(error.message);
      return;
    }
    setFeatureDialogOpen(false);
    setPendingPoint(null);
    await loadWorkspace(client, activeAccess);
    setSelectedFeatureId(String(data || ""));
    showToast("Location saved");
  };

  const saveFeatureDetails = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || !activeAccess || !selectedFeature || !canEdit) return;
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") || "").trim();
    if (!title) return;
    setSaving(true);
    const { data, error } = await client
      .from("map_features")
      .update({
        title,
        reference_code: String(form.get("reference_code") || "").trim() || null,
        description: String(form.get("description") || "").trim() || null,
        status: String(form.get("status") || "active"),
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
    setSaving(false);
    if (error || !data) {
      showToast(error?.message || "That layer could not be updated.");
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
    if (!selectedLayerId) {
      showToast("Create or select a point layer first.");
      return;
    }
    setPlacementMode(true);
    showToast("Click the map to place the asset.");
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
                  {layer.geometry_type === "point" && canEdit && (
                    <input className="maps-layer-radio" type="radio" name="active-layer" checked={selectedLayerId === layer.id} onChange={() => setSelectedLayerId(layer.id)} aria-label={`Add new locations to ${layer.name}`} />
                  )}
                </label>
                {canEdit && <button type="button" className="maps-layer-settings" onClick={() => setEditingLayer(layer)} aria-label={`Edit ${layer.name} layer`}>•••</button>}
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

          {gate === "ready" && (
            <div className="maps-field-tools">
              {movingFeatureId ? (
                <><button type="button" onClick={cancelMoveFeature}>× <span>Cancel move</span></button><button type="button" onClick={proposeMoveFromGps}>◎ <span>{deviceLocation ? "Use GPS" : "Locate me"}</span></button></>
              ) : (
                <><button type="button" onClick={locating ? () => stopLocating() : startLocating} className={deviceLocation ? "is-active" : ""} title={locating ? "Cancel location search" : "Find my location"}>◎ <span>{locating ? "Cancel" : deviceLocation ? "Center on me" : "Locate me"}</span></button>{canEdit && <button type="button" onClick={beginManualPlacement} className={placementMode ? "is-active" : ""}>＋ <span>{placementMode ? "Click map…" : "Place pin"}</span></button>}{canEdit && <button type="button" onClick={placeAtCurrentLocation}>⌖ <span>Pin here</span></button>}</>
              )}
            </div>
          )}

          {movingFeatureId && !proposedMove && <div className="maps-move-banner"><strong>Move point</strong><span>Drag the selected point or click its new position.</span></div>}

          {locationError && <p className={`maps-location-error${locating ? " is-waiting" : ""}`} role="status">{locationError}</p>}

          {selectedFeature && !movingFeatureId && (
            <article className="maps-detail-card">
              <button type="button" className="maps-detail-close" onClick={() => setSelectedFeatureId(null)} aria-label="Close mapped item">×</button>
              <div className="maps-detail-icon" style={{ background: selectedLayer?.color || "#1ed7b2" }}>{layerIcon(selectedLayer)}</div>
              <div className="maps-detail-title"><span>{selectedLayer?.name || "Mapped item"}</span><h2>{selectedFeature.title}</h2>{selectedFeature.reference_code && <p>{selectedFeature.reference_code}</p>}</div>
              {selectedFeature.description && <p className="maps-detail-description">{selectedFeature.description}</p>}
              {canEdit && <div className="maps-detail-actions"><button type="button" className="maps-detail-edit" onClick={() => setFeatureEditOpen(true)}>Edit item</button><button type="button" className="maps-detail-move" onClick={beginMoveFeature}>Move point</button><button type="button" className="maps-detail-delete" onClick={() => setFeatureDeleteOpen(true)}>Delete item</button></div>}
              <dl>
                <div><dt>Status</dt><dd>{selectedFeature.status}</dd></div>
                <div><dt>Placed with</dt><dd>{selectedFeature.placement_method.replace("_", " ")}</dd></div>
                {selectedFeature.location_accuracy_m !== null && <div><dt>Recorded accuracy</dt><dd>±{Math.round(selectedFeature.location_accuracy_m * 3.28084)} ft</dd></div>}
              </dl>
              <div className="maps-proximity">
                <span>FIELD LOCATION</span>
                <strong>{selectedDistance === null ? "Start locating to measure distance" : formatDistance(selectedDistance)}</strong>
                <small>{deviceLocation ? `Current GPS accuracy ±${Math.round(deviceLocation.accuracyMeters * 3.28084)} ft` : "Your device will report its current accuracy."}</small>
                <button type="button" onClick={locating ? () => stopLocating() : startLocating}>{locating ? "Cancel location search" : deviceLocation ? "Center on me" : "Use my location"}</button>
              </div>
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
              <p>Point layers can be mapped now. Line, polygon, and overlay layers are prepared for the next drawing and import tools.</p>
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
              <label><span>Notes</span><textarea name="description" maxLength={1_000} rows={3} placeholder="Optional field notes" /></label>
              <div className="maps-coordinate-readout"><span>{pendingPoint.latitude.toFixed(7)}, {pendingPoint.longitude.toFixed(7)}</span><small>{pendingPoint.accuracyMeters === null ? "Placed manually" : `Device accuracy ±${Math.round(pendingPoint.accuracyMeters * 3.28084)} ft`}</small></div>
              <footer><button type="button" onClick={() => setFeatureDialogOpen(false)}>Cancel</button><button type="submit" className="is-primary" disabled={saving}>{saving ? "Saving…" : "Save location"}</button></footer>
            </form>
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
              <label><span>Status</span><select name="status" defaultValue={selectedFeature.status}><option value="active">Active</option><option value="inactive">Inactive</option><option value="unknown">Unknown</option></select></label>
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
