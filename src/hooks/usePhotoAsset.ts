import { useCallback, useEffect, useState } from 'react';
import type { PhotoAsset } from '../types';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

export function usePhotoAsset() {
  const [asset, setAsset] = useState<PhotoAsset | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadFile = useCallback((file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Formato no compatible. Usá JPG, PNG, WebP o AVIF.');
      return;
    }

    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      setAsset({
        name: file.name,
        url,
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
      setError(null);
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      setError('No se pudo leer la imagen.');
    };

    image.src = url;
  }, []);

  const clearAsset = useCallback(() => {
    setAsset(null);
    setError(null);
  }, []);

  useEffect(() => {
    return () => {
      if (asset?.url) URL.revokeObjectURL(asset.url);
    };
  }, [asset]);

  return { asset, error, loadFile, clearAsset };
}
