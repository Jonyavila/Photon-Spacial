/**
 * Aplica un suavizado Gaussiano 3x3 sobre el mapa de profundidad normalizado
 * para eliminar ruido de alta frecuencia y escalones en la malla 3D.
 */
export function smoothDepthMap(
  data: Float32Array,
  width: number,
  height: number,
  passes = 2,
): Float32Array {
  let current = new Float32Array(data);
  let next = new Float32Array(data.length);

  // Kernel Gaussiano 3x3 normalizado (suma = 16)
  const kernel = [
    1, 2, 1,
    2, 4, 2,
    1, 2, 1,
  ];

  for (let pass = 0; pass < passes; pass += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let weightedSum = 0;
        let weightTotal = 0;

        for (let ky = -1; ky <= 1; ky += 1) {
          const sampleY = y + ky;
          if (sampleY < 0 || sampleY >= height) continue;

          for (let kx = -1; kx <= 1; kx += 1) {
            const sampleX = x + kx;
            if (sampleX < 0 || sampleX >= width) continue;

            const weight = kernel[(ky + 1) * 3 + (kx + 1)];
            weightedSum += current[sampleY * width + sampleX] * weight;
            weightTotal += weight;
          }
        }

        next[y * width + x] =
          weightTotal > 0 ? weightedSum / weightTotal : current[y * width + x];
      }
    }

    // Intercambiar buffers sin alocar memoria nueva
    const temp = current;
    current = next;
    next = temp;
  }

  return current;
}