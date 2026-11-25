# Architecture notes

## Current prototype

The browser and Electron desktop application share one React renderer. Electron only owns the native window lifecycle. The renderer has no Node integration.

`usePhotoAsset` owns image file validation and object URL lifecycle. `SpatialViewport` owns the Three.js scene and disposes renderer resources when unmounted. The current geometry generator is deliberately local and lightweight.

## Depth data contract (planned)

The future depth service should return a normalized depth map plus metadata:

```ts
export interface DepthResult {
  width: number;
  height: number;
  values: Float32Array; // normalized [0, 1]
  confidence?: Float32Array;
  method: 'monocular-estimation' | 'multi-view' | 'manual';
  provenance: 'estimated' | 'observed';
}
```

The renderer should consume a `DepthResult`, not know which model produced it.

## Platform strategy

- Web: Vite app, later deployable behind a static host.
- Desktop: Electron wrapper around the same web renderer.
- AR/VR: a separate XR adapter around the reusable Three.js scene layer. WebXR availability and device support must be detected at runtime; do not assume every browser or headset supports the same features.
