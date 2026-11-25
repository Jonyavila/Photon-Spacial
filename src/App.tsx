import { useCallback, useState } from 'react';
import type { DragEvent } from 'react';
import {
  Aperture, Box, ChevronDown, CircleHelp, Command, Download, Expand, Eye,
  Image as ImageIcon, Layers3, Play, RotateCcw, Scan, Settings2, Sparkles,
} from 'lucide-react';
import { PhotoDropzone } from './components/PhotoDropzone';
import { SpatialViewport } from './components/SpatialViewport';
import { usePhotoAsset } from './hooks/usePhotoAsset';

interface SceneActions {
  exportGlb: () => Promise<void>;
  replayParticles?: () => void;
}

function App() {
  const { asset, error, loadFile, clearAsset } = usePhotoAsset();
  const [depthIntensity, setDepthIntensity] = useState(65);
  const [showDepth, setShowDepth] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [sceneActions, setSceneActions] = useState<SceneActions | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const handleDrop = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) loadFile(file);
  }, [loadFile]);

  const handleExportGlb = async () => {
    if (!sceneActions || isExporting) return;
    try {
      setIsExporting(true);
      await sceneActions.exportGlb();
    } catch (err) {
      console.error('Error al exportar GLB:', err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <main
      className={`app-shell ${isDragging ? 'app-shell--dragging' : ''}`}
      onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setIsDragging(false);
      }}
      onDrop={handleDrop}
    >
      <header className="topbar">
        <div className="brand">
          <div className="brand__mark"><Aperture size={19} /></div>
          <div><strong>PHOTON</strong><span>SPATIAL REALITY ENGINE</span></div>
        </div>
        <div className="topbar__center">
          <span className="status-dot" /> LOCAL WORKSPACE <span className="topbar__divider">/</span> SPATIAL ENGINE
        </div>
        <div className="topbar__actions">
          <button className="icon-button" aria-label="Help"><CircleHelp size={17} /></button>
          <div className="avatar">P</div>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar__section">
            <span className="eyebrow">WORKSPACE</span>
            <button className="nav-item nav-item--active"><Layers3 size={16} /> Spatial Objects</button>
            <button className="nav-item">
              <ImageIcon size={16} /> Photo Library <span className="nav-count">{asset ? '01' : '00'}</span>
            </button>
          </div>
          <div className="sidebar__section sidebar__section--bottom">
            <span className="eyebrow">ENGINE STATUS</span>
            <div className="engine-status">
              <span className="status-dot" />
              <div><strong>Renderer online</strong><small>WebGL · Three.js</small></div>
            </div>
            <div className="engine-status">
              <span className="status-dot" />
              <div><strong>AI depth model</strong><small>Depth Anything V2</small></div>
            </div>
          </div>
          <div className="sidebar__footer">PHOTON BUILD <strong>0.3.0</strong></div>
        </aside>

        <section className="main-panel">
          <div className="page-heading">
            <div>
              <div className="breadcrumb">WORKSPACE <span>/</span> SPATIAL OBJECT</div>
              <h1>Spatial Object</h1>
              <p>Transform a flat photograph into a navigable spatial surface.</p>
            </div>
            <button className="button button--secondary"><Command size={14} /> Shortcuts <kbd>⌘ K</kbd></button>
          </div>

          <div className="viewport-card">
            <div className="viewport-toolbar">
              <div className="viewport-toolbar__left">
                <span className="live-indicator" /> VIEWPORT <span className="toolbar-separator">·</span> {asset ? 'SCENE MATERIALIZED' : 'AWAITING INPUT'}
              </div>
              <div className="viewport-toolbar__right">
                <span className="view-label">PERSPECTIVE</span>
                <button className="icon-button icon-button--small" aria-label="Expand viewport"><Expand size={15} /></button>
              </div>
            </div>
            <div className="viewport-stage">
              {asset ? (
                <SpatialViewport
                  asset={asset}
                  depthIntensity={depthIntensity}
                  showDepth={showDepth}
                  onSceneReady={setSceneActions}
                />
              ) : (
                <div className="empty-state">
                  <div className="empty-state__orb"><Aperture size={35} strokeWidth={1.2} /></div>
                  <span className="eyebrow">PHOTON / INPUT 001</span>
                  <h2>Give your image<br />a new dimension.</h2>
                  <p>Import a photograph to generate its spatial representation.</p>
                  <PhotoDropzone onFile={loadFile} />
                </div>
              )}
              {asset && (
                <div className="viewport-hint">
                  <span>DRAG</span> Rotate <i /> <span>SCROLL</span> Zoom <i /> <span>RIGHT-DRAG</span> Pan
                </div>
              )}
              {isDragging && <div className="drag-overlay">Drop image to reconstruct</div>}
            </div>
            <div className="viewport-footer">
              <div className="viewport-footer__item"><span>ENGINE</span><strong>DEPTH + PARTICLES</strong></div>
              <div className="viewport-footer__item"><span>GEOMETRY</span><strong>{asset ? `${asset.width} × ${asset.height}` : '—'}</strong></div>
              <div className="viewport-footer__item"><span>DEPTH MODEL</span><strong>DEPTH ANYTHING V2</strong></div>
              <div className="viewport-footer__item"><span>RENDER</span><strong>REALTIME</strong></div>
            </div>
          </div>

          {error && <div className="error-message">{error}</div>}

          <div className="bottom-grid">
            <section className="panel-card">
              <div className="panel-card__heading">
                <div><span className="eyebrow">01 / SOURCE</span><h3>Input image</h3></div>
                <button className="text-button" onClick={clearAsset} disabled={!asset}>Clear</button>
              </div>
              {asset ? (
                <div className="source-preview">
                  <img src={asset.url} alt="Uploaded source" />
                  <div className="source-preview__details">
                    <strong>{asset.name}</strong>
                    <span>{asset.width} × {asset.height} px</span>
                  </div>
                  <PhotoDropzone compact onFile={loadFile} />
                </div>
              ) : (
                <div className="source-empty"><ImageIcon size={19} /><span>No source image selected</span></div>
              )}
            </section>

            <section className="panel-card">
              <div className="panel-card__heading">
                <div><span className="eyebrow">02 / SPATIAL PARAMETERS</span><h3>Depth controls</h3></div>
                <Settings2 size={17} className="muted-icon" />
              </div>
              <div className="control-row">
                <label htmlFor="depth-range">Depth intensity</label>
                <strong>{depthIntensity}%</strong>
              </div>
              <input
                id="depth-range"
                className="range-input"
                type="range"
                min="0"
                max="150"
                value={depthIntensity}
                onChange={(event) => setDepthIntensity(Number(event.target.value))}
              />
              <div className="range-labels"><span>Subtle</span><span>Exaggerated</span></div>
              <button
                className={`toggle-row ${showDepth ? 'toggle-row--active' : ''}`}
                onClick={() => setShowDepth((value) => !value)}
              >
                <span><Eye size={15} /> Spatial tint</span><span className="toggle-switch"><i /></span>
              </button>
              <p className="helper-copy">
                Monocular depth estimated via Depth Anything V2 with smoothed 2.5D mesh projection and particle emergence.
              </p>
            </section>
          </div>

          <div className="disclaimer">
            <Sparkles size={14} />
            <span>
              <strong>PHOTON 0.3:</strong> Reconstructs a smoothed 2.5D surface and particle cloud from monocular depth. Next milestone: semantic layer segmentation & occlusion inpainting.
            </span>
          </div>
        </section>

        <aside className="inspector">
          <div className="inspector__heading">
            <div><span className="eyebrow">INSPECTOR</span><h3>Scene properties</h3></div>
            <button className="icon-button" aria-label="Inspector options"><ChevronDown size={16} /></button>
          </div>
          <div className="inspector__section">
            <span className="eyebrow">TRANSFORM</span>
            <div className="property-row"><span>Mode</span><strong><Box size={14} /> Spatial Object</strong></div>
            <div className="property-row"><span>Rotation</span><strong>Orbit controls</strong></div>
            <div className="property-row"><span>Projection</span><strong>Perspective</strong></div>
          </div>
          <div className="inspector__section">
            <span className="eyebrow">RECONSTRUCTION</span>
            <div className="reconstruction-meter">
              <div><span>Depth field</span><strong>{asset ? 'Generated' : 'Waiting'}</strong></div>
              <div className="meter-track"><i style={{ width: asset ? `${Math.min(depthIntensity, 100)}%` : '0%' }} /></div>
            </div>
            <div className="property-row"><span>Geometry</span><strong>{asset ? 'Smoothed 2.5D mesh' : '—'}</strong></div>
            <div className="property-row"><span>Source fidelity</span><strong className="fidelity-label">AI Monocular</strong></div>
          </div>
          <div className="inspector__section">
            <span className="eyebrow">ACTIONS</span>
            {sceneActions?.replayParticles && (
              <button className="action-button" onClick={sceneActions.replayParticles}>
                <Play size={15} /> Replay emergence
              </button>
            )}
            <button className="action-button" onClick={() => clearAsset()} disabled={!asset}>
              <RotateCcw size={15} /> Reset workspace
            </button>
            <button
              className="action-button"
              onClick={handleExportGlb}
              disabled={!sceneActions || isExporting}
            >
              <Download size={15} /> {isExporting ? 'Exporting GLB...' : 'Export 3D asset (.GLB)'}
              {!sceneActions && <span className="coming-soon">LOAD PHOTO</span>}
            </button>
          </div>
          <div className="inspector__tip">
            <Scan size={17} />
            <div>
              <strong>Next milestone · 0.4</strong>
              <p>Scene Understanding: separate sky, terrain, water, and foreground objects into independent layers.</p>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

export default App;