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

type GateState = "loading" | "signed-out" | "unassigned" | "ready" | "error";
type BasemapStyle = "standard" | "satellite";

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

function layerIcon(layer: MapLayer | undefined): string {
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
  const [featureDialogOpen, setFeatureDialogOpen] = useState(false);
  const [placementMode, setPlacementMode] = useState(false);
  const [pendingPoint, setPendingPoint] = useState<PointCoordinates | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [deviceLocation, setDeviceLocation] = useState<DeviceLocation | null>(null);
  const [locationError, setLocationError] = useState("");

  const canEdit = activeAccess?.role === "account_admin" || activeAccess?.role === "editor";
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
          setGate("unassigned");
          setGateMessage(request?.status === "approved"
            ? "Your early access is approved. The next setup step will create your blank Maps workspace."
            : request?.status === "pending"
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
      attributionControl: true,
    });
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "bottom-right");
    mapRef.current = map;
    return () => {
      featureMarkersRef.current.forEach((marker) => marker.remove());
      featureMarkersRef.current.clear();
      locationMarkerRef.current?.remove();
      map.remove();
      mapRef.current = null;
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
      button.className = `maps-marker${selectedFeatureId === feature.id ? " is-selected" : ""}`;
      button.style.setProperty("--marker-color", layer?.color || "#1ed7b2");
      button.textContent = layerIcon(layer);
      button.setAttribute("aria-label", `Open ${feature.title}`);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        setSelectedFeatureId(feature.id);
        setSidebarOpen(false);
      });
      const marker = new mapboxgl.Marker({ element: button, anchor: "bottom" })
        .setLngLat(coordinates)
        .addTo(map);
      featureMarkersRef.current.set(feature.id, marker);
    });
  }, [features, layers, selectedFeatureId, visibleLayers]);

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

  useEffect(() => () => {
    if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
  }, []);

  const chooseOrganization = async (organizationId: string) => {
    const access = accessList.find((item) => item.organizationId === organizationId);
    if (!client || !access) return;
    window.localStorage.setItem(ACTIVE_ORGANIZATION_KEY, organizationId);
    setSelectedFeatureId(null);
    try {
      await loadWorkspace(client, access);
    } catch (error) {
      console.warn("The selected maps workspace could not be loaded.", error);
      setGate("error");
      setGateMessage("That maps workspace could not be loaded.");
    }
  };

  const startLocating = () => {
    if (!navigator.geolocation) {
      setLocationError("Location is not available on this device.");
      return;
    }
    setLocationError("");
    if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = navigator.geolocation.watchPosition((position) => {
      const nextLocation: DeviceLocation = {
        longitude: position.coords.longitude,
        latitude: position.coords.latitude,
        accuracyMeters: position.coords.accuracy,
      };
      setDeviceLocation(nextLocation);
      const map = mapRef.current;
      if (!map) return;
      if (!locationMarkerRef.current) {
        const element = document.createElement("div");
        element.className = "maps-user-location";
        locationMarkerRef.current = new mapboxgl.Marker({ element }).addTo(map);
      }
      locationMarkerRef.current.setLngLat([nextLocation.longitude, nextLocation.latitude]);
      if (!selectedFeatureId) map.easeTo({ center: [nextLocation.longitude, nextLocation.latitude], zoom: Math.max(map.getZoom(), 17) });
    }, () => {
      setLocationError("Allow precise location access to use field locating.");
    }, { enableHighAccuracy: true, maximumAge: 1_000, timeout: 15_000 });
  };

  const placeAtCurrentLocation = () => {
    if (!deviceLocation) {
      startLocating();
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
        <a className="maps-brand" href="/maps/" aria-label="N3XRA Maps home">
          <span className="maps-brand-mark"><b>N3</b><em>XRA</em></span>
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
            <header><div><span>Layers</span><small>{layers.length}</small></div>{canEdit && <button type="button" onClick={() => setLayerDialogOpen(true)}>＋</button>}</header>
            {layers.length ? layers.map((layer) => (
              <label className="maps-layer" key={layer.id}>
                <input type="checkbox" checked={visibleLayers[layer.id] !== false} onChange={() => toggleLayer(layer.id)} />
                <i style={{ background: layer.color }}>{layerIcon(layer)}</i>
                <span><strong>{layer.name}</strong><small>{layer.geometry_type} · {features.filter((feature) => feature.layer_id === layer.id).length} items</small></span>
                {layer.geometry_type === "point" && canEdit && (
                  <input className="maps-layer-radio" type="radio" name="active-layer" checked={selectedLayerId === layer.id} onChange={() => setSelectedLayerId(layer.id)} aria-label={`Add new locations to ${layer.name}`} />
                )}
              </label>
            )) : (
              <div className="maps-empty-list"><span>◇</span><strong>No layers yet</strong><p>Create a layer when you are ready to begin mapping.</p></div>
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
            <div className="maps-gate">
              <span className="maps-gate-mark">◇</span>
              <p>N3XRA MAPS</p>
              <h2>{gate === "loading" ? "Opening Maps" : gate === "signed-out" ? "Sign in to continue" : gate === "unassigned" ? "Ready for activation" : "Maps needs attention"}</h2>
              <span>{gateMessage}</span>
              {gate === "signed-out" && <a href="/account/?next=/maps/app/">Sign in</a>}
              {gate === "unassigned" && <a href="/account/#available-apps-section">Return to dashboard</a>}
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
              <button type="button" onClick={startLocating} title="Find my location">◎ <span>Locate me</span></button>
              {canEdit && <button type="button" onClick={beginManualPlacement} className={placementMode ? "is-active" : ""}>＋ <span>{placementMode ? "Click map…" : "Place pin"}</span></button>}
              {canEdit && <button type="button" onClick={placeAtCurrentLocation}>⌖ <span>Pin here</span></button>}
            </div>
          )}

          {locationError && <p className="maps-location-error">{locationError}</p>}

          {selectedFeature && (
            <article className="maps-detail-card">
              <button type="button" className="maps-detail-close" onClick={() => setSelectedFeatureId(null)} aria-label="Close mapped item">×</button>
              <div className="maps-detail-icon" style={{ background: selectedLayer?.color || "#1ed7b2" }}>{layerIcon(selectedLayer)}</div>
              <div className="maps-detail-title"><span>{selectedLayer?.name || "Mapped item"}</span><h2>{selectedFeature.title}</h2>{selectedFeature.reference_code && <p>{selectedFeature.reference_code}</p>}</div>
              {selectedFeature.description && <p className="maps-detail-description">{selectedFeature.description}</p>}
              <dl>
                <div><dt>Status</dt><dd>{selectedFeature.status}</dd></div>
                <div><dt>Placed with</dt><dd>{selectedFeature.placement_method.replace("_", " ")}</dd></div>
                {selectedFeature.location_accuracy_m !== null && <div><dt>Recorded accuracy</dt><dd>±{Math.round(selectedFeature.location_accuracy_m * 3.28084)} ft</dd></div>}
              </dl>
              <div className="maps-proximity">
                <span>FIELD LOCATION</span>
                <strong>{selectedDistance === null ? "Start locating to measure distance" : formatDistance(selectedDistance)}</strong>
                <small>{deviceLocation ? `Current GPS accuracy ±${Math.round(deviceLocation.accuracyMeters * 3.28084)} ft` : "Your device will report its current accuracy."}</small>
                <button type="button" onClick={startLocating}>Use my location</button>
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

      {toast && <div className="maps-toast" role="status">{toast}</div>}
    </div>
  );
}
