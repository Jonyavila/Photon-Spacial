import * as THREE from "three";

export interface ParticleDepthMap {
  width: number;
  height: number;
  data: Float32Array;
}

export interface ParticleSystemOptions {
  width: number;
  height: number;
  depthScale?: number;
  maxParticles?: number;
  pointScale?: number;
  duration?: number;
}

const vertexShader = `
  attribute vec3 aColor;
  attribute vec3 aOrigin;
  attribute float aSize;
  attribute float aEdge;
  attribute float aDelay;
  attribute float aBorderMask;

  uniform float uPixelRatio;
  uniform float uProgress;
  uniform float uTime;
  uniform float uPointScale;
  uniform float uDepthScale;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vEdge;
  varying float vProgress;

  void main() {
    vColor = aColor;
    vEdge = aEdge;

    float localProgress = clamp(
      (uProgress - aDelay * 0.5) / (1.0 - aDelay * 0.5),
      0.0,
      1.0
    );

    float easedProgress = 1.0 - pow(1.0 - localProgress, 3.0);
    vProgress = easedProgress;

    vec3 targetPosition = position;
    targetPosition.z = targetPosition.z * uDepthScale + 0.005;

    float travel = 1.0 - easedProgress;
    vec3 swirl = vec3(
      sin(uTime * 2.4 + aDelay * 25.0 + position.y * 2.0),
      cos(uTime * 2.1 + aDelay * 19.0 + position.x * 2.0),
      sin(uTime * 1.8 + aDelay * 31.0)
    ) * 0.22 * travel;

    vec3 animatedPosition = mix(aOrigin, targetPosition, easedProgress) + swirl;

    // Respiración orgánica continua
    float outerFactor = max(aEdge, 1.0 - aBorderMask);
    animatedPosition.z += sin(uTime * 1.4 + aDelay * 14.0) * 0.015 * easedProgress * outerFactor;
    animatedPosition.y += cos(uTime * 1.1 + aDelay * 10.0) * 0.008 * easedProgress * outerFactor;

    float birthAlpha = smoothstep(0.0, 0.14, localProgress);
    // Mantiene partículas visibles tanto en la superficie (0.65) como en bordes/contornos (0.95)
    float settledVisibility = clamp(0.65 + aEdge * 0.30 + (1.0 - aBorderMask) * 0.25, 0.0, 0.95);
    float settleAlpha = mix(1.0, settledVisibility, easedProgress);

    vAlpha = birthAlpha * settleAlpha;

    vec4 mvPosition = modelViewMatrix * vec4(animatedPosition, 1.0);
    float perspective = 1.0 / max(0.45, -mvPosition.z);

    float pulse = 1.0 + sin(uTime * 1.8 + aDelay * 12.0) * 0.05;

    gl_PointSize = clamp(
      aSize * uPointScale * uPixelRatio * perspective * pulse,
      1.2,
      10.5
    );

    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vEdge;
  varying float vProgress;

  void main() {
    vec2 centered = gl_PointCoord - vec2(0.5);
    float dist = length(centered);

    float core = 1.0 - smoothstep(0.05, 0.48, dist);
    float glow = 1.0 - smoothstep(0.0, 0.5, dist);

    // Evita que píxeles muy oscuros desaparezcan contra el fondo del viewport
    vec3 liftedColor = max(vColor, vec3(0.08, 0.14, 0.22));
    vec3 scanTint = vec3(0.25, 0.75, 1.0);
    float tintStrength = vEdge * 0.32 * (1.0 - vProgress * 0.55);

    vec3 finalColor = mix(liftedColor, scanTint, tintStrength);
    finalColor += liftedColor * glow * 0.20;

    float alpha = core * vAlpha;
    if (alpha < 0.015) discard;

    gl_FragColor = vec4(finalColor, alpha * 0.94);

    #include <colorspace_fragment>
  }
`;

function getLuminance(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const safeX = Math.max(0, Math.min(width - 1, x));
  const safeY = Math.max(0, Math.min(height - 1, y));
  const index = (safeY * width + safeX) * 4;

  const red = pixels[index] / 255;
  const green = pixels[index + 1] / 255;
  const blue = pixels[index + 2] / 255;

  return red * 0.299 + green * 0.587 + blue * 0.114;
}

function getEdgeIntensity(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const left = getLuminance(pixels, width, height, x - 1, y);
  const right = getLuminance(pixels, width, height, x + 1, y);
  const top = getLuminance(pixels, width, height, x, y - 1);
  const bottom = getLuminance(pixels, width, height, x, y + 1);

  const horizontal = Math.abs(right - left);
  const vertical = Math.abs(bottom - top);

  return Math.min(
    1,
    Math.sqrt(horizontal * horizontal + vertical * vertical) * 2.5,
  );
}

function randomFromSeed(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function createFallbackDepthMap(image: HTMLImageElement): ParticleDepthMap {
  const width = Math.min(256, image.naturalWidth || 256);
  const aspect = (image.naturalHeight || 256) / (image.naturalWidth || 256);
  const height = Math.max(2, Math.round(width * aspect));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const data = new Float32Array(width * height);

  if (ctx) {
    ctx.drawImage(image, 0, 0, width, height);
    const pixels = ctx.getImageData(0, 0, width, height).data;
    for (let i = 0; i < width * height; i += 1) {
      const idx = i * 4;
      data[i] =
        (pixels[idx] * 0.299 + pixels[idx + 1] * 0.587 + pixels[idx + 2] * 0.114) /
        255;
    }
  } else {
    data.fill(0.5);
  }

  return { width, height, data };
}

export class ParticleSystem {
  private readonly points: THREE.Points<
    THREE.BufferGeometry,
    THREE.ShaderMaterial
  >;

  private readonly material: THREE.ShaderMaterial;
  private readonly baseDepthScale: number;
  private readonly duration: number;

  private elapsed = 0;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    image: HTMLImageElement,
    depthMap?: ParticleDepthMap,
    options?: ParticleSystemOptions,
  ) {
    const resolvedDepthMap = depthMap ?? createFallbackDepthMap(image);
    const aspectRatio =
      (image.naturalWidth || resolvedDepthMap.width) /
      Math.max(1, image.naturalHeight || resolvedDepthMap.height);

    const resolvedOptions: ParticleSystemOptions = {
      width: options?.width ?? 5.2,
      height: options?.height ?? 5.2 / aspectRatio,
      depthScale: options?.depthScale ?? 0.75,
      maxParticles: options?.maxParticles ?? 28000,
      pointScale: options?.pointScale ?? 1,
      duration: options?.duration ?? 3.8,
    };

    this.baseDepthScale = resolvedOptions.depthScale!;
    this.duration = resolvedOptions.duration!;

    const geometry = this.createGeometry(
      image,
      resolvedDepthMap,
      resolvedOptions,
    );

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uPixelRatio: {
          value: Math.min(window.devicePixelRatio, 2),
        },
        uProgress: { value: 0 },
        uTime: { value: 0 },
        uPointScale: {
          value: resolvedOptions.pointScale!,
        },
        uDepthScale: {
          value: this.baseDepthScale,
        },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
    });

    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;

    scene.add(this.points);
  }

  private createGeometry(
    image: HTMLImageElement,
    depthMap: ParticleDepthMap,
    options: ParticleSystemOptions,
  ): THREE.BufferGeometry {
    const canvas = document.createElement("canvas");
    canvas.width = depthMap.width;
    canvas.height = depthMap.height;

    const context = canvas.getContext("2d", {
      willReadFrequently: true,
    });

    if (!context) {
      throw new Error("No se pudo crear el contexto de imagen.");
    }

    context.drawImage(image, 0, 0, depthMap.width, depthMap.height);

    const pixels = context.getImageData(
      0,
      0,
      depthMap.width,
      depthMap.height,
    ).data;

    const pixelCount = depthMap.width * depthMap.height;
    const maxParticles = options.maxParticles ?? 28000;

    const samplingStep = Math.max(
      1,
      Math.ceil(Math.sqrt(pixelCount / maxParticles)),
    );

    const cellWidth = (options.width / depthMap.width) * samplingStep;
    const cellHeight = (options.height / depthMap.height) * samplingStep;

    let depthSum = 0;
    for (let i = 0; i < depthMap.data.length; i += 1) {
      depthSum += THREE.MathUtils.clamp(depthMap.data[i] ?? 0.5, 0, 1);
    }
    const meanDepth =
      depthMap.data.length > 0 ? depthSum / depthMap.data.length : 0.5;

    const positions: number[] = [];
    const origins: number[] = [];
    const colors: number[] = [];
    const sizes: number[] = [];
    const edges: number[] = [];
    const delays: number[] = [];
    const borderMasks: number[] = [];

    for (let y = 0; y < depthMap.height; y += samplingStep) {
      for (let x = 0; x < depthMap.width; x += samplingStep) {
        const index = y * depthMap.width + x;
        const colorIndex = index * 4;

        const alpha = pixels[colorIndex + 3] / 255;
        if (alpha < 0.05) continue;

        const red = pixels[colorIndex] / 255;
        const green = pixels[colorIndex + 1] / 255;
        const blue = pixels[colorIndex + 2] / 255;

        const depth = THREE.MathUtils.clamp(
          depthMap.data[index] ?? meanDepth,
          0,
          1,
        );

        const edge = getEdgeIntensity(
          pixels,
          depthMap.width,
          depthMap.height,
          x,
          y,
        );

        const normalizedX =
          depthMap.width > 1 ? x / (depthMap.width - 1) : 0.5;
        const normalizedY =
          depthMap.height > 1 ? y / (depthMap.height - 1) : 0.5;

        const edgeDistX = Math.min(normalizedX, 1 - normalizedX) * 2;
        const edgeDistY = Math.min(normalizedY, 1 - normalizedY) * 2;
        const borderMask = THREE.MathUtils.smoothstep(
          Math.min(edgeDistX, edgeDistY),
          0.0,
          0.20,
        );

        const worldX = (normalizedX - 0.5) * options.width;
        const worldY = (0.5 - normalizedY) * options.height;
        const normalizedDepth = depth - meanDepth;

        const r1 = randomFromSeed(index + 1);
        const r2 = randomFromSeed(index + 17);
        const r3 = randomFromSeed(index + 37);

        const jitterX =
          (r1 - 0.5) * (cellWidth * 0.55 + (1 - borderMask) * 0.16);
        const jitterY =
          (r2 - 0.5) * (cellHeight * 0.55 + (1 - borderMask) * 0.16);
        const jitterZ = (r3 - 0.5) * ((1 - borderMask) * 0.16);

        positions.push(
          worldX + jitterX,
          worldY + jitterY,
          normalizedDepth + jitterZ,
        );

        const angle = r1 * Math.PI * 2;
        const radius = 0.25 + r2 * 0.85;

        origins.push(
          Math.cos(angle) * radius * 0.6,
          -options.height * 0.35 + Math.sin(angle) * radius * 0.4,
          0.85 + r3 * 0.9,
        );

        colors.push(red, green, blue);

        sizes.push(0.9 + edge * 1.1 + (1 - borderMask) * 0.55);
        edges.push(edge);
        borderMasks.push(borderMask);

        const radialDist = Math.hypot(normalizedX - 0.5, normalizedY - 0.65);
        const waveDelay = THREE.MathUtils.clamp(radialDist * 0.55, 0, 0.5);
        delays.push(waveDelay + randomFromSeed(index + 91) * 0.20);
      }
    }

    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute(
      "aOrigin",
      new THREE.Float32BufferAttribute(origins, 3),
    );
    geometry.setAttribute(
      "aColor",
      new THREE.Float32BufferAttribute(colors, 3),
    );
    geometry.setAttribute(
      "aSize",
      new THREE.Float32BufferAttribute(sizes, 1),
    );
    geometry.setAttribute(
      "aEdge",
      new THREE.Float32BufferAttribute(edges, 1),
    );
    geometry.setAttribute(
      "aDelay",
      new THREE.Float32BufferAttribute(delays, 1),
    );
    geometry.setAttribute(
      "aBorderMask",
      new THREE.Float32BufferAttribute(borderMasks, 1),
    );

    geometry.computeBoundingSphere();

    return geometry;
  }

  setDepthIntensity(intensity: number): void {
    if (this.disposed) return;

    const multiplier = THREE.MathUtils.clamp(intensity / 65, 0, 3);
    this.material.uniforms.uDepthScale.value =
      this.baseDepthScale * multiplier;
  }

  update(delta: number): void {
    if (this.disposed) return;

    this.elapsed += delta;
    this.material.uniforms.uTime.value = this.elapsed;
    this.material.uniforms.uProgress.value = Math.min(
      1,
      this.elapsed / this.duration,
    );
  }

  restart(): void {
    if (this.disposed) return;

    this.elapsed = 0;
    this.material.uniforms.uProgress.value = 0;
    this.material.uniforms.uTime.value = 0;
  }

  dispose(): void {
    if (this.disposed) return;

    this.disposed = true;
    this.points.removeFromParent();
    this.points.geometry.dispose();
    this.material.dispose();
  }
}