import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { VRButton } from "three/addons/webxr/VRButton.js";

import type { PhotoAsset } from "../types";
import { reconstructSpatialScene } from "../services/depthApi";
import { ParticleSystem } from "./ParticleSystem";
import type { ParticleDepthMap } from "./ParticleSystem";
import { exportMeshToGlb } from "../utils/exportGlb";

export interface SpatialSceneActions {
  exportGlb: () => Promise<void>;
  replayParticles: () => void;
}

interface SpatialViewportProps {
  asset: PhotoAsset | null;
  depthIntensity: number;
  showDepth: boolean;
  onSceneReady?: (actions: SpatialSceneActions | null) => void;
}

interface LayerEntry {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  zOffset: number;
}

interface SceneState {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  grid: THREE.GridHelper;
  sceneGroup: THREE.Group | null;
  layers: LayerEntry[];
  particles: ParticleSystem | null;
  clock: THREE.Clock;
  revealElapsed: number;
  depthUniform: { value: number };
}

interface SpatialGeometryResult {
  geometry: THREE.BufferGeometry;
  texture: THREE.Texture;
  alphaTexture: THREE.Texture;
}

const MAX_WORLD_SIZE = 5.2;
const DEPTH_SCALE = 0.75;
const MAX_GEOMETRY_SEGMENTS = 220;
const REVEAL_DURATION = 3.8;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => {
      reject(new Error("No se pudo cargar la fotografía."));
    };
    image.src = src;
  });
}

async function loadPhotoFile(
  url: string,
  name: string,
  signal: AbortSignal,
): Promise<File> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error("No se pudo recuperar el archivo original.");
  }
  const blob = await response.blob();
  return new File([blob], name, {
    type: blob.type || "image/jpeg",
  });
}

function getWorldDimensions(image: HTMLImageElement) {
  const naturalW = Math.max(1, image.naturalWidth);
  const naturalH = Math.max(1, image.naturalHeight);
  const aspectRatio = naturalW / naturalH;

  if (aspectRatio >= 1) {
    return {
      width: MAX_WORLD_SIZE,
      height: MAX_WORLD_SIZE / aspectRatio,
      aspectRatio,
    };
  }

  return {
    width: MAX_WORLD_SIZE * aspectRatio,
    height: MAX_WORLD_SIZE,
    aspectRatio,
  };
}

function hasGroundPlane(depthMap: ParticleDepthMap): boolean {
  const { width, height, data } = depthMap;
  if (width < 4 || height < 4) return false;

  const bandHeight = Math.max(1, Math.floor(height * 0.18));
  let topSum = 0;
  let topCount = 0;
  let bottomSum = 0;
  let bottomCount = 0;

  for (let y = 0; y < bandHeight; y += 1) {
    for (let x = 0; x < width; x += 1) {
      topSum += data[y * width + x] ?? 0.5;
      topCount += 1;
    }
  }

  for (let y = height - bandHeight; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      bottomSum += data[y * width + x] ?? 0.5;
      bottomCount += 1;
    }
  }

  const topAvg = topSum / Math.max(1, topCount);
  const bottomAvg = bottomSum / Math.max(1, bottomCount);

  return bottomAvg - topAvg > 0.12;
}

function createEdgeFeatherTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (ctx) {
    const imageData = ctx.createImageData(size, size);
    const data = imageData.data;

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const nx = x / (size - 1);
        const ny = y / (size - 1);

        const edgeX = Math.min(nx, 1 - nx) * 2;
        const edgeY = Math.min(ny, 1 - ny) * 2;
        const edgeFactor = Math.min(edgeX, edgeY);

        const alpha = THREE.MathUtils.smoothstep(edgeFactor, 0.01, 0.16);
        const val = Math.round(alpha * 255);

        const idx = (y * size + x) * 4;
        data[idx] = val;
        data[idx + 1] = val;
        data[idx + 2] = val;
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function createLayerGeometry(
  image: HTMLImageElement,
  depthMap: ParticleDepthMap,
  meanDepth: number,
  maxAnisotropy: number,
): SpatialGeometryResult {
  const { width: worldWidth, height: worldHeight, aspectRatio } =
    getWorldDimensions(image);

  let width: number;
  let height: number;

  if (aspectRatio >= 1) {
    width = Math.min(MAX_GEOMETRY_SEGMENTS, depthMap.width);
    height = Math.max(2, Math.round(width / aspectRatio));
  } else {
    height = Math.min(MAX_GEOMETRY_SEGMENTS, depthMap.height);
    width = Math.max(2, Math.round(height * aspectRatio));
  }

  const vertexCount = (width + 1) * (height + 1);

  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const baseZ = new Float32Array(vertexCount);
  const depthAttr = new Float32Array(vertexCount);

  const indices: number[] = [];

  for (let y = 0; y <= height; y += 1) {
    for (let x = 0; x <= width; x += 1) {
      const vertex = y * (width + 1) + x;

      const depthX = Math.min(
        depthMap.width - 1,
        Math.round((x / width) * (depthMap.width - 1)),
      );

      const depthY = Math.min(
        depthMap.height - 1,
        Math.round((y / height) * (depthMap.height - 1)),
      );

      const depthIndex = depthY * depthMap.width + depthX;

      const depthValue = THREE.MathUtils.clamp(
        depthMap.data[depthIndex] ?? meanDepth,
        0,
        1,
      );

      const z = (depthValue - meanDepth) * DEPTH_SCALE;

      const normalizedX = x / width - 0.5;
      const normalizedY = 0.5 - y / height;

      positions[vertex * 3] = normalizedX * worldWidth;
      positions[vertex * 3 + 1] = normalizedY * worldHeight;
      positions[vertex * 3 + 2] = z;

      baseZ[vertex] = z;
      depthAttr[vertex] = depthValue;

      uvs[vertex * 2] = x / width;
      uvs[vertex * 2 + 1] = 1 - y / height;

      if (x < width && y < height) {
        const a = vertex;
        const b = vertex + 1;
        const c = vertex + width + 1;
        const d = c + 1;

        indices.push(a, c, b, b, c, d);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute("aDepth", new THREE.BufferAttribute(depthAttr, 1));

  geometry.setIndex(indices);
  geometry.userData.baseZ = baseZ;

  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const texture = new THREE.Texture(image);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;

  const alphaTexture = createEdgeFeatherTexture();

  return {
    geometry,
    texture,
    alphaTexture,
  };
}

function attachAntiStretchShader(
  material: THREE.MeshStandardMaterial,
  depthUniform: { value: number },
  isCutoutForeground: boolean,
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDepthMultiplier = depthUniform;

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute float aDepth;
        varying float vDepth;
        varying vec3 vWorldNormal;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vDepth = aDepth;
        vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );

    // En primer plano recortado (retratos/paisajes separados) limpiamos bordes laterales extremos;
    // en el telón de fondo o superficie continua nunca descartamos cielo ni horizontes.
    const stretchRules = isCutoutForeground
      ? `float sideFade = smoothstep(0.04, 0.22, abs(vWorldNormal.z));
         gl_FragColor.a *= sideFade;
         if (gl_FragColor.a < 0.04) discard;`
      : `float slope = length(vec2(dFdx(vDepth), dFdy(vDepth))) * max(0.5, uDepthMultiplier);
         float stretchFade = 1.0 - smoothstep(0.04, 0.12, slope) * 0.45;
         gl_FragColor.a *= stretchFade;`;

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uDepthMultiplier;
        varying float vDepth;
        varying vec3 vWorldNormal;`,
      )
      .replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>
        ${stretchRules}`,
      );
  };

  material.customProgramCacheKey = () =>
    isCutoutForeground ? "photon-fg-cutout-v2" : "photon-anti-stretch-v2";
}

function disposeLayer(layer: LayerEntry): void {
  layer.mesh.removeFromParent();
  layer.mesh.geometry.dispose();
  layer.material.map?.dispose();
  layer.material.emissiveMap?.dispose();
  layer.material.alphaMap?.dispose();
  layer.material.dispose();
}

function clearSpatialContent(state: SceneState): void {
  state.particles?.dispose();
  state.particles = null;

  for (const layer of state.layers) {
    disposeLayer(layer);
  }
  state.layers = [];

  if (state.sceneGroup) {
    state.sceneGroup.removeFromParent();
    state.sceneGroup = null;
  }

  state.revealElapsed = 0;
  state.grid.visible = false;
}

function applyDepthIntensity(
  layers: LayerEntry[],
  intensity: number,
  depthUniform: { value: number },
): void {
  const multiplier = THREE.MathUtils.clamp(intensity / 65, 0, 3);
  depthUniform.value = multiplier;

  for (let i = 0; i < layers.length; i += 1) {
    const layer = layers[i];
    const isBackgroundLayer = layers.length > 1 && i === 0;
    const layerMultiplier = isBackgroundLayer ? multiplier * 0.35 : multiplier;

    const position = layer.mesh.geometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    const baseZ = layer.mesh.geometry.userData.baseZ as Float32Array | undefined;
    if (!baseZ) continue;

    for (let index = 0; index < position.count; index += 1) {
      position.setZ(index, baseZ[index] * layerMultiplier);
    }

    position.needsUpdate = true;
    layer.mesh.position.z = layer.zOffset * multiplier;
    layer.mesh.geometry.computeVertexNormals();
    layer.mesh.geometry.computeBoundingSphere();
  }
}

function applySpatialTint(layers: LayerEntry[], enabled: boolean): void {
  const tint = enabled ? "#c9e5ff" : "#ffffff";
  for (const layer of layers) {
    layer.material.color.set(tint);
    layer.material.emissive.set(tint);
  }
}

function fitCameraToImage(
  state: SceneState,
  image: HTMLImageElement,
  viewportWidth: number,
  viewportHeight: number,
): void {
  if (!viewportWidth || !viewportHeight) return;

  const { width, height } = getWorldDimensions(image);
  const viewportAspect = viewportWidth / viewportHeight;
  const verticalFov = THREE.MathUtils.degToRad(state.camera.fov);

  const distanceForHeight = height / (2 * Math.tan(verticalFov / 2));
  const distanceForWidth =
    width / (2 * Math.tan(verticalFov / 2) * viewportAspect);

  const distance = Math.max(distanceForHeight, distanceForWidth) * 1.08;

  state.camera.position.set(0, 0, distance);
  state.controls.target.set(0, 0, 0);
  state.controls.update();
}

function rendererMaxAnisotropy(renderer: THREE.WebGLRenderer): number {
  return Math.min(8, renderer.capabilities.getMaxAnisotropy());
}

function updateMeshReveal(state: SceneState): void {
  if (state.layers.length === 0) return;

  const rawProgress =
    (state.revealElapsed - REVEAL_DURATION * 0.35) / (REVEAL_DURATION * 0.65);

  const progress = THREE.MathUtils.clamp(rawProgress, 0, 1);
  const easedProgress = progress * progress * (3 - 2 * progress);

  for (const layer of state.layers) {
    layer.material.opacity = easedProgress * 0.96;
    layer.material.depthWrite = easedProgress > 0.65;
  }
}

export function SpatialViewport({
  asset,
  depthIntensity,
  showDepth,
  onSceneReady,
}: SpatialViewportProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneStateRef = useRef<SceneState | null>(null);

  const depthIntensityRef = useRef(depthIntensity);
  const showDepthRef = useRef(showDepth);

  depthIntensityRef.current = depthIntensity;
  showDepthRef.current = showDepth;

  // --------------------------------------------------
  // 1. Inicialización de Three.js + WebXR + Navegación WASD
  // --------------------------------------------------
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0b121e");

    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100);
    camera.position.set(0, 0, 5);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
    });

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.xr.enabled = true;

    mount.appendChild(renderer.domElement);

    // Mostrar botón WebXR únicamente si hay hardware/sesión VR soportada
    let vrButton: HTMLElement | null = null;
    let vrCancelled = false;

    if (navigator.xr) {
      navigator.xr
        .isSessionSupported("immersive-vr")
        .then((supported) => {
          if (!supported || vrCancelled || !mount) return;
          vrButton = VRButton.createButton(renderer);
          vrButton.style.bottom = "16px";
          vrButton.style.right = "16px";
          vrButton.style.left = "auto";
          vrButton.style.zIndex = "20";
          mount.appendChild(vrButton);
        })
        .catch(() => {});
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 0.7;
    controls.maxDistance = 20;
    controls.enablePan = true;

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.4);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0x9fcaff, 1.6);
    keyLight.position.set(-1, 2, 3);
    scene.add(keyLight);

    const grid = new THREE.GridHelper(5, 28, 0x24405d, 0x15263b);
    grid.visible = false;
    scene.add(grid);

    const state: SceneState = {
      scene,
      camera,
      renderer,
      controls,
      grid,
      sceneGroup: null,
      layers: [],
      particles: null,
      clock: new THREE.Clock(),
      revealElapsed: 0,
      depthUniform: { value: 1 },
    };

    sceneStateRef.current = state;

    // Controles de navegación espacial libre con teclado (W A S D + Q E + Flechas)
    const keys = new Set<string>();
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement
      ) {
        return;
      }
      keys.add(event.code);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keys.delete(event.code);
    };
    const onBlur = () => keys.clear();

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    const resize = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      if (!width || !height) return;

      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();

    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();

    renderer.setAnimationLoop(() => {
      const deltaTime = Math.min(state.clock.getDelta(), 0.05);

      if (keys.size > 0) {
        const moveSpeed = 2.4 * deltaTime;
        camera.getWorldDirection(forward);
        forward.y = 0;
        if (forward.lengthSq() > 1e-6) {
          forward.normalize();
          right.crossVectors(forward, camera.up).normalize();

          if (keys.has("KeyW") || keys.has("ArrowUp")) {
            camera.position.addScaledVector(forward, moveSpeed);
            controls.target.addScaledVector(forward, moveSpeed);
          }
          if (keys.has("KeyS") || keys.has("ArrowDown")) {
            camera.position.addScaledVector(forward, -moveSpeed);
            controls.target.addScaledVector(forward, -moveSpeed);
          }
          if (keys.has("KeyD") || keys.has("ArrowRight")) {
            camera.position.addScaledVector(right, moveSpeed);
            controls.target.addScaledVector(right, moveSpeed);
          }
          if (keys.has("KeyA") || keys.has("ArrowLeft")) {
            camera.position.addScaledVector(right, -moveSpeed);
            controls.target.addScaledVector(right, -moveSpeed);
          }
          if (keys.has("KeyE")) {
            camera.position.y += moveSpeed;
            controls.target.y += moveSpeed;
          }
          if (keys.has("KeyQ")) {
            camera.position.y -= moveSpeed;
            controls.target.y -= moveSpeed;
          }
        }
      }

      controls.update();

      if (state.layers.length > 0) {
        state.revealElapsed += deltaTime;
        updateMeshReveal(state);
      }

      state.particles?.update(deltaTime);

      renderer.render(scene, camera);
    });

    return () => {
      vrCancelled = true;
      renderer.setAnimationLoop(null);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      observer.disconnect();
      controls.dispose();
      clearSpatialContent(state);
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      renderer.dispose();

      if (vrButton && mount.contains(vrButton)) {
        mount.removeChild(vrButton);
      }
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }

      sceneStateRef.current = null;
    };
  }, []);

  // --------------------------------------------------
  // 2. Reconstrucción Espacial Multi-Capa (v0.4 + v0.5)
  // --------------------------------------------------
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    const reconstruct = async () => {
      const current = sceneStateRef.current;

      if (!asset) {
        if (current) {
          clearSpatialContent(current);
        }
        onSceneReady?.(null);
        return;
      }

      try {
        const [originalImage, photoFile] = await Promise.all([
          loadImage(asset.url),
          loadPhotoFile(asset.url, asset.name, controller.signal),
        ]);

        if (cancelled) return;

        const spatialData = await reconstructSpatialScene(
          photoFile,
          controller.signal,
        );

        if (cancelled) return;

        const state = sceneStateRef.current;
        if (!state) return;

        clearSpatialContent(state);

        const fgDepthData = spatialData.foreground.depthMap.data;
        let depthSum = 0;
        for (let i = 0; i < fgDepthData.length; i += 1) {
          depthSum += THREE.MathUtils.clamp(fgDepthData[i] ?? 0.5, 0, 1);
        }
        const meanDepth =
          fgDepthData.length > 0 ? depthSum / fgDepthData.length : 0.5;

        const sceneGroup = new THREE.Group();
        const createdLayers: LayerEntry[] = [];
        const initialTint = showDepthRef.current ? 0xc9e5ff : 0xffffff;
        const maxAnisotropy = rendererMaxAnisotropy(state.renderer);

        // Capa 1: Fondo reconstruido por inpainting (sin huecos)
        if (spatialData.hasLayers && spatialData.background) {
          const bgImage = await loadImage(spatialData.background.imageUrl);
          if (cancelled) return;

          const bgGeo = createLayerGeometry(
            bgImage,
            spatialData.background.depthMap,
            meanDepth,
            maxAnisotropy,
          );

          const bgMat = new THREE.MeshStandardMaterial({
            map: bgGeo.texture,
            emissiveMap: bgGeo.texture,
            emissive: new THREE.Color(initialTint),
            emissiveIntensity: 0.78,
            alphaMap: bgGeo.alphaTexture,
            color: initialTint,
            roughness: 0.92,
            metalness: 0,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0,
            depthWrite: false,
          });

          attachAntiStretchShader(bgMat, state.depthUniform, false);

          const bgMesh = new THREE.Mesh(bgGeo.geometry, bgMat);
          bgMesh.renderOrder = 1;
          sceneGroup.add(bgMesh);

          createdLayers.push({
            mesh: bgMesh,
            material: bgMat,
            zOffset: -0.04,
          });
        }

        // Capa 2: Primer plano (sujeto recortado o plano cercano del paisaje)
        const fgImage =
          spatialData.hasLayers && spatialData.foreground.imageUrl
            ? await loadImage(spatialData.foreground.imageUrl)
            : originalImage;

        if (cancelled) return;

        const fgGeo = createLayerGeometry(
          fgImage,
          spatialData.foreground.depthMap,
          meanDepth,
          maxAnisotropy,
        );

        const fgMat = new THREE.MeshStandardMaterial({
          map: fgGeo.texture,
          emissiveMap: fgGeo.texture,
          emissive: new THREE.Color(initialTint),
          emissiveIntensity: 0.82,
          alphaMap: fgGeo.alphaTexture,
          alphaTest: spatialData.hasLayers ? 0.12 : 0,
          color: initialTint,
          roughness: 0.92,
          metalness: 0,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        });

        attachAntiStretchShader(
          fgMat,
          state.depthUniform,
          spatialData.hasLayers,
        );

        const fgMesh = new THREE.Mesh(fgGeo.geometry, fgMat);
        fgMesh.renderOrder = 2;
        sceneGroup.add(fgMesh);

        createdLayers.push({
          mesh: fgMesh,
          material: fgMat,
          zOffset: spatialData.hasLayers ? 0.03 : 0,
        });

        state.scene.add(sceneGroup);
        state.sceneGroup = sceneGroup;
        state.layers = createdLayers;
        state.revealElapsed = 0;

        applyDepthIntensity(
          createdLayers,
          depthIntensityRef.current,
          state.depthUniform,
        );
        applySpatialTint(createdLayers, showDepthRef.current);

        const { width, height } = getWorldDimensions(originalImage);

        const showFloor = hasGroundPlane(spatialData.foreground.depthMap);
        state.grid.visible = showFloor;
        if (showFloor) {
          state.grid.position.set(0, -height * 0.54, 0);
          const gridScale = Math.max(width, height) / 4.6;
          state.grid.scale.set(gridScale, 1, gridScale);
        }

        const particles = new ParticleSystem(
          state.scene,
          originalImage,
          spatialData.foreground.depthMap,
          {
            width,
            height,
            depthScale: DEPTH_SCALE,
            maxParticles: 28000,
            pointScale: 1,
            duration: REVEAL_DURATION,
          },
        );

        particles.setDepthIntensity(depthIntensityRef.current);
        state.particles = particles;

        const mount = mountRef.current;
        if (mount) {
          fitCameraToImage(
            state,
            originalImage,
            mount.clientWidth,
            mount.clientHeight,
          );
        }

        onSceneReady?.({
          exportGlb: async () => {
            if (state.sceneGroup) {
              const baseName = asset.name.replace(/\.[^/.]+$/, "");
              await exportMeshToGlb(
                state.sceneGroup as unknown as THREE.Mesh,
                `${baseName}-photon.glb`,
              );
            }
          },
          replayParticles: () => {
            state.revealElapsed = 0;
            for (const layer of state.layers) {
              layer.material.opacity = 0;
              layer.material.depthWrite = false;
            }
            state.particles?.restart();
          },
        });
      } catch (error) {
        if (cancelled) return;
        console.error("PHOTON reconstruction failed:", error);
      }
    };

    void reconstruct();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [asset, onSceneReady]);

  // --------------------------------------------------
  // 3. Sincronizar profundidad de capas y partículas
  // --------------------------------------------------
  useEffect(() => {
    const state = sceneStateRef.current;
    if (!state) return;

    if (state.layers.length > 0) {
      applyDepthIntensity(state.layers, depthIntensity, state.depthUniform);
    }

    state.particles?.setDepthIntensity(depthIntensity);
  }, [depthIntensity, asset]);

  // --------------------------------------------------
  // 4. Control de tinte espacial
  // --------------------------------------------------
  useEffect(() => {
    const state = sceneStateRef.current;
    if (!state || state.layers.length === 0) return;

    applySpatialTint(state.layers, showDepth);
  }, [showDepth, asset]);

  return <div className="spatial-viewport" ref={mountRef} />;
}