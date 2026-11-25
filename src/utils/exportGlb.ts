import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

function cloneMeshForExport(sourceMesh: THREE.Mesh): THREE.Mesh {
  const geometry = sourceMesh.geometry.clone();
  // Eliminamos atributos custom de shaders para que GLTFExporter serialice limpio
  geometry.deleteAttribute("aDepth");

  const sourceMat = Array.isArray(sourceMesh.material)
    ? sourceMesh.material[0]
    : sourceMesh.material;

  let exportMaterial: THREE.MeshStandardMaterial;

  if (sourceMat instanceof THREE.MeshStandardMaterial) {
    exportMaterial = new THREE.MeshStandardMaterial({
      map: sourceMat.map ?? null,
      color: sourceMat.color.clone(),
      roughness: sourceMat.roughness,
      metalness: sourceMat.metalness,
      side: THREE.DoubleSide,
      transparent: sourceMat.transparent,
      opacity: 1,
      alphaTest: sourceMat.alphaTest > 0 ? sourceMat.alphaTest : 0.05,
    });
  } else {
    exportMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
    });
  }

  const cleanMesh = new THREE.Mesh(geometry, exportMaterial);
  cleanMesh.name = sourceMesh.name || "PhotonLayer";
  cleanMesh.position.copy(sourceMesh.position);
  cleanMesh.rotation.copy(sourceMesh.rotation);
  cleanMesh.scale.copy(sourceMesh.scale);

  return cleanMesh;
}

export async function exportMeshToGlb(
  target: THREE.Object3D,
  filename = "photon-scene.glb",
): Promise<void> {
  const exportRoot = new THREE.Group();
  exportRoot.name = "PhotonSpatialScene";

  const clonedMaterials: THREE.Material[] = [];
  const clonedGeometries: THREE.BufferGeometry[] = [];

  target.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const cleanMesh = cloneMeshForExport(child);
      exportRoot.add(cleanMesh);
      clonedGeometries.push(cleanMesh.geometry);
      if (cleanMesh.material instanceof THREE.Material) {
        clonedMaterials.push(cleanMesh.material);
      }
    }
  });

  if (exportRoot.children.length === 0) {
    throw new Error("No se encontraron mallas 3D válidas para exportar.");
  }

  const exporter = new GLTFExporter();

  try {
    const glbBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      exporter.parse(
        exportRoot,
        (result) => {
          if (result instanceof ArrayBuffer) {
            resolve(result);
          } else {
            reject(new Error("El exportador no generó un binario GLB válido."));
          }
        },
        (error) => reject(error),
        { binary: true },
      );
    });

    const blob = new Blob([glbBuffer], { type: "model/gltf-binary" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } finally {
    clonedGeometries.forEach((geo) => geo.dispose());
    clonedMaterials.forEach((mat) => mat.dispose());
  }
}