import LayersIcon from './LayersIcon';
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { mapColors } from '../lib/mapColors';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useModalPresence, useInertOutside } from '../hooks/useModalPresence';
import { toUserMessage } from '../lib/errors';
import { resolveServiceUrl } from '../lib/serviceUrl';
import { parseCSVLine, parseCSV, parseKML, parseGPX, parseGeoJsonUpload } from '../lib/layerParsers';

// ============ Types ============

export type ServiceType = 'wms' | 'wmts' | 'wfs' | 'wcs' | 'tms' | 'xyz';
export type FileType = 'geojson' | 'kml' | 'gpx' | 'csv' | 'topojson';

export interface ServiceLayer {
  id: string;
  name: string;
  title: string;
  abstract?: string;
  enabled: boolean;
  opacity: number;
}

export interface OGCServiceConfig {
  id: string;
  type: 'ogc-service';
  serviceType: ServiceType;
  name: string;
  url: string;
  layers: ServiceLayer[];
  version?: string;
  format?: string;
  transparent?: boolean;
  opacity: number;
  zIndex: number;
}

export interface FileLayerConfig {
  id: string;
  type: 'file';
  fileType: FileType;
  name: string;
  data: unknown;
  visible: boolean;
  opacity: number;
  zIndex: number;
  style?: {
    color?: string;
    weight?: number;
    fillColor?: string;
    fillOpacity?: number;
    radius?: number;
  };
  // CSV-specific
  latColumn?: string;
  lngColumn?: string;
}

export interface XYZLayerConfig {
  id: string;
  type: 'xyz';
  name: string;
  url: string;
  visible: boolean;
  opacity: number;
  zIndex: number;
  attribution?: string;
}

export type CustomLayerConfig = OGCServiceConfig | FileLayerConfig | XYZLayerConfig;

interface LayerManagerProps {
  layers: CustomLayerConfig[];
  onLayersChange: (layers: CustomLayerConfig[]) => void;
  onClose: () => void;
}

// ============ Helper Functions ============

/** Said once, in the form, when a map service does not answer. */
const SERVICE_UNREACHABLE = 'Tjenesten svarte ikke. Sjekk adressen og tjenestetypen, og prøv igjen.';

const generateId = () => `layer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// Parse WMS GetCapabilities XML
async function parseWMSCapabilities(url: string): Promise<{ layers: ServiceLayer[]; version: string }> {
  const capUrl = resolveServiceUrl(url);
  capUrl.searchParams.set('service', 'WMS');
  capUrl.searchParams.set('request', 'GetCapabilities');
  
  const response = await fetchWithTimeout(capUrl.toString());
  if (!response.ok) {
    console.warn(`[layers] GetCapabilities failed with status ${response.status}`);
    throw new Error(SERVICE_UNREACHABLE);
  }
  
  const text = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'text/xml');
  
  // Check for parse errors
  const parseError = doc.querySelector('parsererror');
  if (parseError) throw new Error('Tjenesten svarte med noe som ikke er en gyldig tjenestebeskrivelse.');
  
  // Get version
  const root = doc.documentElement;
  const version = root.getAttribute('version') || '1.1.1';
  
  // Parse layers
  const layers: ServiceLayer[] = [];
  
  // Get all named layers
  doc.querySelectorAll('Layer').forEach((layerEl, idx) => {
    const nameEl = layerEl.querySelector(':scope > Name');
    const titleEl = layerEl.querySelector(':scope > Title');
    const abstractEl = layerEl.querySelector(':scope > Abstract');
    
    if (nameEl?.textContent) {
      layers.push({
        id: `wms-layer-${idx}-${nameEl.textContent}`,
        name: nameEl.textContent,
        title: titleEl?.textContent || nameEl.textContent,
        abstract: abstractEl?.textContent || undefined,
        enabled: false,
        opacity: 1
      });
    }
  });
  
  return { layers, version };
}

// Parse WMTS GetCapabilities
async function parseWMTSCapabilities(url: string): Promise<{ layers: ServiceLayer[]; version: string }> {
  const capUrl = resolveServiceUrl(url);
  capUrl.searchParams.set('service', 'WMTS');
  capUrl.searchParams.set('request', 'GetCapabilities');
  
  const response = await fetchWithTimeout(capUrl.toString());
  if (!response.ok) {
    console.warn(`[layers] GetCapabilities failed with status ${response.status}`);
    throw new Error(SERVICE_UNREACHABLE);
  }
  
  const text = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'text/xml');
  
  const layers: ServiceLayer[] = [];
  
  // WMTS uses ows:Identifier for layer names
  doc.querySelectorAll('Layer').forEach((layerEl, idx) => {
    const identifier = layerEl.querySelector('Identifier')?.textContent;
    const title = layerEl.querySelector('Title')?.textContent;
    const abstract = layerEl.querySelector('Abstract')?.textContent;
    
    if (identifier) {
      layers.push({
        id: `wmts-layer-${idx}-${identifier}`,
        name: identifier,
        title: title || identifier,
        abstract: abstract || undefined,
        enabled: false,
        opacity: 1
      });
    }
  });
  
  return { layers, version: '1.0.0' };
}

// Parse WFS GetCapabilities
async function parseWFSCapabilities(url: string): Promise<{ layers: ServiceLayer[]; version: string }> {
  const capUrl = resolveServiceUrl(url);
  capUrl.searchParams.set('service', 'WFS');
  capUrl.searchParams.set('request', 'GetCapabilities');
  
  const response = await fetchWithTimeout(capUrl.toString());
  if (!response.ok) {
    console.warn(`[layers] GetCapabilities failed with status ${response.status}`);
    throw new Error(SERVICE_UNREACHABLE);
  }
  
  const text = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'text/xml');
  
  const version = doc.documentElement.getAttribute('version') || '2.0.0';
  const layers: ServiceLayer[] = [];
  
  // WFS uses FeatureType elements
  doc.querySelectorAll('FeatureType').forEach((ftEl, idx) => {
    const name = ftEl.querySelector('Name')?.textContent;
    const title = ftEl.querySelector('Title')?.textContent;
    const abstract = ftEl.querySelector('Abstract')?.textContent;
    
    if (name) {
      layers.push({
        id: `wfs-layer-${idx}-${name}`,
        name: name,
        title: title || name,
        abstract: abstract || undefined,
        enabled: false,
        opacity: 1
      });
    }
  });
  
  return { layers, version };
}

// Parse WCS GetCapabilities
async function parseWCSCapabilities(url: string): Promise<{ layers: ServiceLayer[]; version: string }> {
  const capUrl = resolveServiceUrl(url);
  capUrl.searchParams.set('service', 'WCS');
  capUrl.searchParams.set('request', 'GetCapabilities');
  
  const response = await fetchWithTimeout(capUrl.toString());
  if (!response.ok) {
    console.warn(`[layers] GetCapabilities failed with status ${response.status}`);
    throw new Error(SERVICE_UNREACHABLE);
  }
  
  const text = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'text/xml');
  
  const version = doc.documentElement.getAttribute('version') || '2.0.1';
  const layers: ServiceLayer[] = [];
  
  // WCS uses CoverageId or Identifier
  doc.querySelectorAll('CoverageSummary, CoverageOfferingBrief').forEach((covEl, idx) => {
    const id = covEl.querySelector('CoverageId, Identifier, name')?.textContent;
    const title = covEl.querySelector('Title, label')?.textContent;
    const abstract = covEl.querySelector('Abstract, description')?.textContent;
    
    if (id) {
      layers.push({
        id: `wcs-layer-${idx}-${id}`,
        name: id,
        title: title || id,
        abstract: abstract || undefined,
        enabled: false,
        opacity: 1
      });
    }
  });
  
  return { layers, version };
}

// ============ Sub-Components ============

interface ServiceLayerListProps {
  service: OGCServiceConfig;
  onToggleLayer: (layerId: string) => void;
  onLayerOpacityChange: (layerId: string, opacity: number) => void;
}

const ServiceLayerList: React.FC<ServiceLayerListProps> = ({ service, onToggleLayer, onLayerOpacityChange }) => {
  const [expanded, setExpanded] = useState(true);
  const enabledCount = service.layers.filter(l => l.enabled).length;
  
  return (
    <div className="mt-2 rounded border border-border-default bg-surface-tinted">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition hover:bg-surface-hover focus:outline-none focus-visible:bg-surface-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-base-default"
      >
        <span className="font-medium text-text-default">
          Lag ({enabledCount}/{service.layers.length} aktivert)
        </span>
        <svg
          className={`h-4 w-4 transform text-text-subtle transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div className="max-h-64 overflow-y-auto border-t border-border-default p-2">
          {service.layers.map(layer => (
            <div
              key={layer.id}
              className="rounded p-2 hover:bg-surface-hover"
            >
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={layer.enabled}
                  onChange={() => onToggleLayer(layer.id)}
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded-sm accent-base-default focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default focus-visible:ring-offset-2 focus-visible:ring-offset-surface-default"
                />
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm font-medium text-text-default">{layer.title}</div>
                  {layer.abstract && (
                    <div className="truncate text-xs text-text-subtle">{layer.abstract}</div>
                  )}
                  <div className="text-xs text-text-subtle">{layer.name}</div>
                </div>
              </label>
              {layer.enabled && (
                <div className="mt-2 flex items-center gap-2 pl-6">
                  <span className="text-xs text-text-subtle">Synlighet</span>
                  <input
                    type="range"
                    aria-label={`Synlighet, ${layer.name}`}
                    aria-valuetext={`${Math.round(layer.opacity * 100)} %`}
                    min="0"
                    max="1"
                    step="0.1"
                    value={layer.opacity}
                    onChange={(e) => onLayerOpacityChange(layer.id, parseFloat(e.target.value))}
                    className="h-1 w-20 cursor-pointer appearance-none rounded-lg bg-neutral-border-default"
                  />
                  <span className="w-10 text-xs tabular-nums text-text-subtle">{Math.round(layer.opacity * 100)}%</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ============ Main Component ============

/** The three tabs, in order; ids double as the activeTab state. */
const TABS = [
  { id: 'layers', label: 'Egne kartlag' },
  { id: 'add-service', label: 'Legg til karttjeneste' },
  { id: 'add-file', label: 'Importer fil' }
] as const;

const LayerManager: React.FC<LayerManagerProps> = ({ layers, onLayersChange, onClose }) => {
  const titleId = React.useId();
  const tabsId = React.useId();
  // Open on the first tab, not on the close button.
  const firstTabRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>({
    active: true,
    onEscape: onClose,
    initialFocusRef: firstTabRef
  });
  // A modal: what lies behind it, the toasts included, steps back while it
  // is open — out of the accessibility tree too, not by `aria-modal` alone
  // (see useModalPresence).
  useModalPresence();
  useInertOutside(dialogRef);

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const index = TABS.findIndex((tab) => tab.id === activeTab);
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    else return;
    event.preventDefault();
    setActiveTab(TABS[next].id);
    document.getElementById(`${tabsId}-tab-${TABS[next].id}`)?.focus();
  };
  const [activeTab, setActiveTab] = useState<'layers' | 'add-service' | 'add-file'>('layers');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Add service form state
  const [serviceUrl, setServiceUrl] = useState('');
  const [serviceName, setServiceName] = useState('');
  const [serviceType, setServiceType] = useState<ServiceType>('wms');
  
  // Add file state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileData, setFileData] = useState<{ name: string; content: string; type: FileType } | null>(null);
  const [csvColumns, setCsvColumns] = useState<string[]>([]);
  const [latColumn, setLatColumn] = useState('');
  const [lngColumn, setLngColumn] = useState('');
  const [fileStyle, setFileStyle] = useState({
    // The documented default for the user's own data (Peat Brown).
    color: mapColors.fileVector,
    fillColor: mapColors.fileVector,
    fillOpacity: '0.3'
  });

  // Reorder layers
  const moveLayer = useCallback((index: number, direction: 'up' | 'down') => {
    const newLayers = [...layers];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    
    if (targetIndex < 0 || targetIndex >= newLayers.length) return;
    
    [newLayers[index], newLayers[targetIndex]] = [newLayers[targetIndex], newLayers[index]];
    
    // Update zIndex based on position
    newLayers.forEach((layer, idx) => {
      layer.zIndex = newLayers.length - idx;
    });
    
    onLayersChange(newLayers);
  }, [layers, onLayersChange]);

  // Remove layer — undoable in place. The confirmation and its "Angre" take
  // the removed row's spot inside the dialog, where the action happened; a
  // toast would sit over the dialog instead.
  const [removedNotice, setRemovedNotice] = useState<{ layer: CustomLayerConfig; index: number } | null>(null);
  const removedNoticeId = React.useId();
  const undoRef = useRef<HTMLButtonElement>(null);
  const focusLayerIdRef = useRef<string | null>(null);

  const removeLayer = useCallback((id: string) => {
    const index = layers.findIndex((l) => l.id === id);
    if (index === -1) return;
    setRemovedNotice({ layer: layers[index], index });
    onLayersChange(layers.filter(l => l.id !== id));
  }, [layers, onLayersChange]);

  // Put the layer back where it was, into the list as it is now, so changes
  // made since the removal are kept.
  const undoRemove = useCallback(() => {
    if (!removedNotice) return;
    const restored = [...layers];
    restored.splice(Math.min(removedNotice.index, restored.length), 0, removedNotice.layer);
    focusLayerIdRef.current = removedNotice.layer.id;
    setRemovedNotice(null);
    onLayersChange(restored);
  }, [layers, onLayersChange, removedNotice]);

  // Rename in place: Enter or leaving the field saves, Escape keeps the old
  // name; focus returns to the name either way.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const renameClosedRef = useRef(false);
  const startRename = (id: string) => {
    renameClosedRef.current = false;
    setRenamingId(id);
  };
  const finishRename = (id: string, value: string | null) => {
    if (renameClosedRef.current) return;
    renameClosedRef.current = true;
    focusLayerIdRef.current = id;
    setRenamingId(null);
    const name = value?.trim();
    if (name && layers.some((l) => l.id === id && l.name !== name)) {
      onLayersChange(layers.map((l) => (l.id === id ? { ...l, name } : l)));
    }
  };

  // Focus follows the action: onto "Angre" after a removal, onto the layer's
  // name after an undo, an add or a rename.
  useEffect(() => {
    if (removedNotice) undoRef.current?.focus();
  }, [removedNotice]);
  useEffect(() => {
    const id = focusLayerIdRef.current;
    if (!id) return;
    const row = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('[data-layer-id]') ?? []).find(
      (node) => node.dataset.layerId === id
    );
    if (!row) return;
    focusLayerIdRef.current = null;
    row.querySelector<HTMLElement>('[data-layer-name]')?.focus();
  }, [layers, activeTab, renamingId, dialogRef]);

  // Toggle service layer
  const toggleServiceLayer = useCallback((serviceId: string, layerId: string) => {
    onLayersChange(layers.map(l => {
      if (l.id === serviceId && l.type === 'ogc-service') {
        return {
          ...l,
          layers: l.layers.map(sl => 
            sl.id === layerId ? { ...sl, enabled: !sl.enabled } : sl
          )
        };
      }
      return l;
    }));
  }, [layers, onLayersChange]);

  // Toggle file layer visibility
  const toggleFileVisibility = useCallback((id: string) => {
    onLayersChange(layers.map(l => {
      if (l.id === id && (l.type === 'file' || l.type === 'xyz')) {
        return { ...l, visible: !l.visible };
      }
      return l;
    }));
  }, [layers, onLayersChange]);

  // Update opacity
  const updateOpacity = useCallback((id: string, opacity: number) => {
    onLayersChange(layers.map(l => 
      l.id === id ? { ...l, opacity } : l
    ));
  }, [layers, onLayersChange]);

  // Update layer opacity within a service
  const updateLayerOpacity = useCallback((serviceId: string, layerId: string, opacity: number) => {
    onLayersChange(layers.map(l => {
      if (l.id === serviceId && l.type === 'ogc-service') {
        return {
          ...l,
          layers: l.layers.map(sl => 
            sl.id === layerId ? { ...sl, opacity } : sl
          )
        };
      }
      return l;
    }));
  }, [layers, onLayersChange]);

  // Add OGC service
  const handleAddService = async () => {
    if (!serviceUrl.trim()) {
      setError('Skriv inn adressen til tjenesten først.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let parsedLayers: ServiceLayer[] = [];
      let version = '';

      switch (serviceType) {
        case 'wms':
          ({ layers: parsedLayers, version } = await parseWMSCapabilities(serviceUrl));
          break;
        case 'wmts':
          ({ layers: parsedLayers, version } = await parseWMTSCapabilities(serviceUrl));
          break;
        case 'wfs':
          ({ layers: parsedLayers, version } = await parseWFSCapabilities(serviceUrl));
          break;
        case 'wcs':
          ({ layers: parsedLayers, version } = await parseWCSCapabilities(serviceUrl));
          break;
        case 'tms':
        case 'xyz':
          // For TMS/XYZ, no capabilities - just add as-is
          parsedLayers = [{
            id: 'main',
            name: 'tiles',
            title: 'Tiles',
            enabled: true,
            opacity: 1
          }];
          version = '1.0.0';
          break;
      }

      if (parsedLayers.length === 0 && serviceType !== 'tms' && serviceType !== 'xyz') {
        throw new Error('Tjenesten svarte, men uten kartlag.');
      }

      const newService: OGCServiceConfig = {
        id: generateId(),
        type: 'ogc-service',
        serviceType,
        name: serviceName.trim() || resolveServiceUrl(serviceUrl).hostname,
        url: serviceUrl.trim(),
        layers: parsedLayers,
        version,
        format: serviceType === 'wms' ? 'image/png' : undefined,
        transparent: true,
        opacity: 1,
        zIndex: layers.length + 1
      };

      focusLayerIdRef.current = newService.id;
      onLayersChange([...layers, newService]);
      setServiceUrl('');
      setServiceName('');
      setActiveTab('layers');
    } catch (err) {
      setError(toUserMessage(err, 'Kunne ikke legge til tjenesten. Sjekk adressen og prøv igjen.'));
    } finally {
      setLoading(false);
    }
  };

  // Handle file selection
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    
    const ext = file.name.split('.').pop()?.toLowerCase();
    let fileType: FileType;
    
    switch (ext) {
      case 'geojson':
      case 'json':
        fileType = 'geojson';
        break;
      case 'kml':
        fileType = 'kml';
        break;
      case 'gpx':
        fileType = 'gpx';
        break;
      case 'csv':
        fileType = 'csv';
        break;
      case 'topojson':
        fileType = 'topojson';
        break;
      default:
        setError('Filtypen støttes ikke. Bruk GeoJSON, KML, GPX eller CSV.');
        return;
    }

    try {
      const content = await file.text();
      setFileData({ name: file.name, content, type: fileType });
      
      // For CSV, detect columns
      if (fileType === 'csv') {
        const firstLine = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')[0] ?? '';
        const columns = parseCSVLine(firstLine);
        setCsvColumns(columns);
        
        // Try to auto-detect lat/lng columns
        const latGuess = columns.find(c => /^(lat|latitude)$/i.test(c));
        const lngGuess = columns.find(c => /^(lng|lon|long|longitude)$/i.test(c));
        if (latGuess) setLatColumn(latGuess);
        if (lngGuess) setLngColumn(lngGuess);
      }
    } catch {
      setError('Kunne ikke lese filen. Sjekk at den er hel, og prøv igjen.');
    }
  };

  // Add file layer
  const handleAddFile = () => {
    if (!fileData) {
      setError('Velg en fil først.');
      return;
    }

    setError(null);

    try {
      let geojsonData: GeoJSON.FeatureCollection;

      switch (fileData.type) {
        case 'geojson':
          // Validates shape and drops undrawable features so Leaflet can never
          // throw on this data later (which would unmount the whole app).
          geojsonData = parseGeoJsonUpload(fileData.content);
          break;
        case 'kml':
          geojsonData = parseKML(fileData.content);
          break;
        case 'gpx':
          geojsonData = parseGPX(fileData.content);
          break;
        case 'csv':
          if (!latColumn || !lngColumn) {
            setError('Velg kolonnene for breddegrad og lengdegrad.');
            return;
          }
          geojsonData = parseCSV(fileData.content, latColumn, lngColumn);
          break;
        case 'topojson': {
          // TopoJSON requires a dedicated decoding library which is not bundled
          // with the app. Rather than silently importing an empty layer, reject
          // the format with a clear message to the user.
          throw new Error(
            'TopoJSON støttes ikke i denne versjonen. Konverter filen til GeoJSON og prøv igjen.'
          );
        }
        default:
          throw new Error('Filtypen støttes ikke. Bruk GeoJSON, KML, GPX eller CSV.');
      }

      const newLayer: FileLayerConfig = {
        id: generateId(),
        type: 'file',
        fileType: fileData.type,
        name: fileData.name,
        data: geojsonData,
        visible: true,
        opacity: 1,
        zIndex: layers.length + 1,
        style: {
          color: fileStyle.color,
          weight: 2,
          fillColor: fileStyle.fillColor,
          fillOpacity: parseFloat(fileStyle.fillOpacity)
        },
        latColumn: fileData.type === 'csv' ? latColumn : undefined,
        lngColumn: fileData.type === 'csv' ? lngColumn : undefined
      };

      focusLayerIdRef.current = newLayer.id;
      onLayersChange([...layers, newLayer]);
      setFileData(null);
      setCsvColumns([]);
      setLatColumn('');
      setLngColumn('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      setActiveTab('layers');
    } catch (err) {
      setError(toUserMessage(err, 'Kunne ikke lese filen. Sjekk at den er hel, og prøv igjen.'));
    }
  };

  const serviceTypeLabels: Record<ServiceType, string> = {
    wms: 'WMS – kartbilder',
    wmts: 'WMTS – ferdige kartfliser',
    wfs: 'WFS – vektordata',
    wcs: 'WCS – rasterdata',
    tms: 'TMS – kartfliser',
    xyz: 'XYZ-fliser'
  };

  const getLayerTypeLabel = (layer: CustomLayerConfig): string => {
    if (layer.type === 'ogc-service') {
      return layer.serviceType.toUpperCase();
    }
    if (layer.type === 'file') {
      return layer.fileType.toUpperCase();
    }
    return 'XYZ';
  };

  const hasEnabledLayers = (layer: CustomLayerConfig): boolean => {
    if (layer.type === 'ogc-service') {
      return layer.layers.some(l => l.enabled);
    }
    if (layer.type === 'file' || layer.type === 'xyz') {
      return layer.visible;
    }
    return false;
  };

  const noticeRow = removedNotice ? (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border-default px-4 py-3 text-sm">
      <span id={removedNoticeId} className="min-w-0 break-words text-text-default">
        Laget «{removedNotice.layer.name}» er fjernet.
      </span>
      <button
        ref={undoRef}
        type="button"
        onClick={undoRemove}
        aria-describedby={removedNoticeId}
        className="shrink-0 rounded-md border border-border-default px-3 py-1 font-medium text-text-default transition hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default focus-visible:ring-offset-2 focus-visible:ring-offset-surface-default"
      >
        Angre
      </button>
    </div>
  ) : null;

  return (
    <div className="fixed inset-0 z-dialog flex items-center justify-center bg-black/50">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-lg border border-border-default bg-surface-default shadow-xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-default px-6 py-4">
          <h2 id={titleId} className="text-lg font-medium text-text-default">Kartlag</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Lukk kartlag"
            className="rounded-full p-1 text-text-subtle transition hover:bg-surface-hover hover:text-text-default focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div
          role="tablist"
          aria-label="Visning"
          className="flex border-b border-border-default"
          onKeyDown={handleTabKeyDown}
        >
          {TABS.map((tab, index) => (
            <button
              key={tab.id}
              ref={index === 0 ? firstTabRef : undefined}
              type="button"
              role="tab"
              id={`${tabsId}-tab-${tab.id}`}
              aria-selected={activeTab === tab.id}
              aria-controls={`${tabsId}-panel-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 px-4 py-3 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-base-default ${
                activeTab === tab.id
                  ? 'border-b-2 border-base-default text-text-default'
                  : 'text-text-subtle hover:text-text-default'
              }`}
            >
              {tab.id === 'layers' ? `Egne kartlag (${layers.length})` : tab.label}
            </button>
          ))}
        </div>

        <div className="max-h-[calc(90vh-12rem)] overflow-y-auto p-6">
          {error && (
            <div role="alert" className="mb-4 rounded-md bg-danger-surface-default p-3 text-sm text-danger-text-default">
              {error}
            </div>
          )}

          {/* Layers Tab */}
          {activeTab === 'layers' && (
            <div role="tabpanel" id={`${tabsId}-panel-layers`} aria-labelledby={`${tabsId}-tab-layers`} className="space-y-3">
              {layers.length === 0 ? (
                <>
                {noticeRow}
                <div className="py-8 text-center text-text-subtle">
                  <LayersIcon className="mx-auto h-12 w-12 text-border-default" strokeWidth={1.5} />
                  <p className="mt-2">Ingen egne kartlag ennå</p>
                  <p className="text-sm">Legg til en karttjeneste eller importer en fil.</p>
                </div>
                </>
              ) : (
                <>
                {layers.map((layer, index) => (
                  <React.Fragment key={layer.id}>
                  {removedNotice?.index === index && noticeRow}
                  <div
                    data-layer-id={layer.id}
                    className={`rounded-lg border p-4 ${
                      hasEnabledLayers(layer) ? 'border-border-default bg-surface-default' : 'border-border-subtle bg-transparent'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Reorder buttons */}
                      <div className="flex flex-col gap-0.5">
                        <button
                          type="button"
                          onClick={() => moveLayer(index, 'up')}
                          disabled={index === 0}
                          className="rounded p-1 text-text-subtle transition hover:bg-surface-hover hover:text-text-default disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default"
                          title="Flytt opp"
                          aria-label={`Flytt laget «${layer.name}» opp`}
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => moveLayer(index, 'down')}
                          disabled={index === layers.length - 1}
                          className="rounded p-1 text-text-subtle transition hover:bg-surface-hover hover:text-text-default disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default"
                          title="Flytt ned"
                          aria-label={`Flytt laget «${layer.name}» ned`}
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                      </div>

                      {/* Layer info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {renamingId === layer.id ? (
                            <input
                              type="text"
                              defaultValue={layer.name}
                              autoFocus
                              aria-label={`Nytt navn på laget «${layer.name}»`}
                              onFocus={(event) => event.currentTarget.select()}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  finishRename(layer.id, event.currentTarget.value);
                                } else if (event.key === 'Escape') {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  finishRename(layer.id, null);
                                }
                              }}
                              onBlur={(event) => finishRename(layer.id, event.currentTarget.value)}
                              className="min-w-0 flex-1 rounded-md border border-base-default bg-surface-default px-2 py-0.5 text-sm font-medium text-text-default focus:outline-none focus:ring-1 focus:ring-base-default"
                            />
                          ) : (
                            <span
                              data-layer-name
                              tabIndex={-1}
                              className="truncate text-sm font-medium text-text-default focus:outline-none"
                            >
                              {layer.name}
                            </span>
                          )}
                          {/* A format is a fact, not a meaning: one neutral chip for every type. */}
                          <span className="rounded border border-border-subtle bg-surface-default px-1.5 py-0.5 text-xs font-medium text-text-default">
                            {getLayerTypeLabel(layer)}
                          </span>
                          {renamingId !== layer.id && (
                            <button
                              type="button"
                              onClick={() => startRename(layer.id)}
                              aria-label={`Gi laget «${layer.name}» nytt navn`}
                              title="Endre navn"
                              className="shrink-0 rounded p-1 text-text-subtle transition hover:bg-surface-hover hover:text-text-default focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default"
                            >
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                              </svg>
                            </button>
                          )}
                        </div>
                        
                        {layer.type === 'ogc-service' && (
                          <div className="mt-1 text-xs text-text-subtle truncate">{layer.url}</div>
                        )}

                        {/* Opacity slider */}
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-xs text-text-subtle">Synlighet</span>
                          <input
                            type="range"
                            aria-label={`Synlighet, ${layer.name}`}
                            aria-valuetext={`${Math.round(layer.opacity * 100)} %`}
                            min="0"
                            max="1"
                            step="0.1"
                            value={layer.opacity}
                            onChange={(e) => updateOpacity(layer.id, parseFloat(e.target.value))}
                            className="h-1 w-24 accent-base-default"
                          />
                          <span className="w-10 text-xs tabular-nums text-text-subtle">{Math.round(layer.opacity * 100)}%</span>
                        </div>

                        {/* Service layers list */}
                        {layer.type === 'ogc-service' && layer.layers.length > 0 && (
                          <ServiceLayerList
                            service={layer}
                            onToggleLayer={(layerId) => toggleServiceLayer(layer.id, layerId)}
                            onLayerOpacityChange={(layerId, opacity) => updateLayerOpacity(layer.id, layerId, opacity)}
                          />
                        )}

                        {/* File layer toggle */}
                        {(layer.type === 'file' || layer.type === 'xyz') && (
                          <div className="mt-2">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={layer.visible}
                                onChange={() => toggleFileVisibility(layer.id)}
                                className="h-4 w-4 shrink-0 cursor-pointer rounded-sm accent-base-default focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default focus-visible:ring-offset-2 focus-visible:ring-offset-surface-default"
                              />
                              <span className="text-sm text-text-default">Synlig</span>
                            </label>
                          </div>
                        )}
                      </div>

                      {/* Remove button */}
                      <button
                        type="button"
                        onClick={() => removeLayer(layer.id)}
                        className="rounded p-1.5 text-danger-text-default transition hover:bg-danger-surface-default hover:text-danger-text-default focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default"
                        title="Fjern lag"
                        aria-label={`Fjern laget «${layer.name}»`}
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  </React.Fragment>
                ))}
                {removedNotice && removedNotice.index >= layers.length && noticeRow}
                </>
              )}
            </div>
          )}

          {/* Add Service Tab */}
          {activeTab === 'add-service' && (
            <div role="tabpanel" id={`${tabsId}-panel-add-service`} aria-labelledby={`${tabsId}-tab-add-service`} className="space-y-4">
              <div>
                <label htmlFor={`${tabsId}-service-type`} className="block text-sm font-medium text-text-default mb-1">Tjenestetype</label>
                <select
                  id={`${tabsId}-service-type`}
                  value={serviceType}
                  onChange={(e) => setServiceType(e.target.value as ServiceType)}
                  className="w-full rounded-md border border-[color:var(--field-border)] px-3 py-2 text-sm focus:border-base-default focus:outline-none focus:ring-1 focus:ring-base-default"
                >
                  {Object.entries(serviceTypeLabels).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor={`${tabsId}-service-url`} className="block text-sm font-medium text-text-default mb-1">Tjeneste-URL *</label>
                <input
                  id={`${tabsId}-service-url`}
                  required
                  aria-required="true"
                  type="url"
                  value={serviceUrl}
                  onChange={(e) => setServiceUrl(e.target.value)}
                  placeholder="https://eksempel.no/wms"
                  className="w-full rounded-md border border-[color:var(--field-border)] px-3 py-2 text-sm focus:border-base-default focus:outline-none focus:ring-1 focus:ring-base-default"
                />
                <p className="mt-1 text-xs text-text-subtle">
                  Adressen til tjenesten, uten parametere. Tilgjengelige kartlag hentes automatisk.
                </p>
              </div>

              <div>
                <label htmlFor={`${tabsId}-service-name`} className="block text-sm font-medium text-text-default mb-1">Visningsnavn (valgfritt)</label>
                <input
                  id={`${tabsId}-service-name`}
                  type="text"
                  value={serviceName}
                  onChange={(e) => setServiceName(e.target.value)}
                  placeholder="Min WMS-tjeneste"
                  className="w-full rounded-md border border-[color:var(--field-border)] px-3 py-2 text-sm focus:border-base-default focus:outline-none focus:ring-1 focus:ring-base-default"
                />
              </div>

              <button
                onClick={handleAddService}
                disabled={loading}
                className="w-full rounded-lg bg-base-default px-4 py-2 text-sm font-medium text-base-contrast-default transition hover:bg-base-hover disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-border-strong"
              >
                {loading ? 'Legger til…' : 'Legg til tjeneste'}
              </button>
            </div>
          )}

          {/* Import File Tab */}
          {activeTab === 'add-file' && (
            <div role="tabpanel" id={`${tabsId}-panel-add-file`} aria-labelledby={`${tabsId}-tab-add-file`} className="space-y-4">
              <div>
                {/* The native file control speaks the browser's language
                    ("Choose File / No file chosen"); a button of our own
                    opens the same picker in Norwegian. The input stays in the
                    DOM for the picker and for tests, out of the tab order. */}
                <input
                  id={`${tabsId}-file`}
                  ref={fileInputRef}
                  type="file"
                  accept=".geojson,.json,.kml,.gpx,.csv"
                  onChange={handleFileSelect}
                  className="sr-only"
                  tabIndex={-1}
                  aria-label="Velg fil"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  aria-describedby={`${tabsId}-file-hint`}
                  className="rounded-lg border border-main-border-default px-3 py-2 text-sm font-medium text-main-text-default transition hover:bg-main-surface-tinted focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default focus-visible:ring-offset-2 focus-visible:ring-offset-surface-default"
                >
                  Velg fil…
                </button>
                <p id={`${tabsId}-file-hint`} className="mt-2 text-xs text-text-subtle">
                  Støttede formater: GeoJSON, KML, GPX og CSV.
                </p>
              </div>

              {fileData && (
                <>
                  <div className="rounded-md bg-surface-tinted p-3">
                    <div className="text-sm font-medium text-text-default">{fileData.name}</div>
                    <div className="text-xs text-text-subtle">Type: {fileData.type.toUpperCase()}</div>
                  </div>

                  {/* CSV column selection */}
                  {fileData.type === 'csv' && csvColumns.length > 0 && (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label htmlFor={`${tabsId}-lat-column`} className="block text-sm font-medium text-text-default mb-1">Breddegradskolonne *</label>
                        <select
                          id={`${tabsId}-lat-column`}
                          required
                          value={latColumn}
                          onChange={(e) => setLatColumn(e.target.value)}
                          className="w-full rounded-md border border-[color:var(--field-border)] px-3 py-2 text-sm focus:border-base-default focus:outline-none focus:ring-1 focus:ring-base-default"
                        >
                          <option value="">Velg kolonne…</option>
                          {csvColumns.map(col => (
                            <option key={col} value={col}>{col}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor={`${tabsId}-lng-column`} className="block text-sm font-medium text-text-default mb-1">Lengdegradskolonne *</label>
                        <select
                          id={`${tabsId}-lng-column`}
                          required
                          value={lngColumn}
                          onChange={(e) => setLngColumn(e.target.value)}
                          className="w-full rounded-md border border-[color:var(--field-border)] px-3 py-2 text-sm focus:border-base-default focus:outline-none focus:ring-1 focus:ring-base-default"
                        >
                          <option value="">Velg kolonne…</option>
                          {csvColumns.map(col => (
                            <option key={col} value={col}>{col}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  {/* Style options */}
                  <div>
                    <label className="block text-sm font-medium text-text-default mb-2">Stil</label>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <label htmlFor={`${tabsId}-stroke`} className="text-xs text-text-subtle">Strek</label>
                        <input
                          id={`${tabsId}-stroke`}
                          type="color"
                          value={fileStyle.color}
                          onChange={(e) => setFileStyle(s => ({ ...s, color: e.target.value }))}
                          className="h-8 w-full cursor-pointer rounded border border-[color:var(--field-border)]"
                        />
                      </div>
                      <div>
                        <label htmlFor={`${tabsId}-fill`} className="text-xs text-text-subtle">Fyll</label>
                        <input
                          id={`${tabsId}-fill`}
                          type="color"
                          value={fileStyle.fillColor}
                          onChange={(e) => setFileStyle(s => ({ ...s, fillColor: e.target.value }))}
                          className="h-8 w-full cursor-pointer rounded border border-[color:var(--field-border)]"
                        />
                      </div>
                      <div>
                        <label htmlFor={`${tabsId}-fill-opacity`} className="text-xs text-text-subtle">Fyll, synlighet</label>
                        <input
                          id={`${tabsId}-fill-opacity`}
                          type="range"
                          min="0"
                          max="1"
                          step="0.1"
                          value={fileStyle.fillOpacity}
                          onChange={(e) => setFileStyle(s => ({ ...s, fillOpacity: e.target.value }))}
                          className="mt-2 h-2 w-full accent-base-default"
                        />
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={handleAddFile}
                    className="w-full rounded-lg bg-base-default px-4 py-2 text-sm font-medium text-base-contrast-default transition hover:bg-base-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-border-strong"
                  >
                    Legg til på kart
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LayerManager;
