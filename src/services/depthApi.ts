export interface DepthMap {
    width: number;
    height: number;
    data: Float32Array;
}

export interface SpatialLayerData {
    imageUrl: string;
    depthMap: DepthMap;
}

export interface SpatialSceneResult {
    width: number;
    height: number;
    hasLayers: boolean;
    foreground: SpatialLayerData;
    background: SpatialLayerData | null;
}

const API_URL = "http://127.0.0.1:8000";

async function decodeDepthFromUrl(url: string): Promise<DepthMap> {
    const response = await fetch(url);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);

    try {
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;

        const context = canvas.getContext("2d", {
            willReadFrequently: true,
        });

        if (!context) {
            throw new Error("No se pudo crear el contexto Canvas.");
        }

        context.drawImage(bitmap, 0, 0);

        const pixels = context.getImageData(
            0,
            0,
            bitmap.width,
            bitmap.height,
        );

        const data = new Float32Array(bitmap.width * bitmap.height);

        for (let index = 0; index < data.length; index += 1) {
            data[index] = pixels.data[index * 4] / 255;
        }

        return {
            width: bitmap.width,
            height: bitmap.height,
            data,
        };
    } finally {
        bitmap.close();
    }
}

export const estimateDepth = async (
    imageFile: File,
    signal?: AbortSignal,
): Promise<DepthMap> => {
    const formData = new FormData();
    formData.append("file", imageFile);

    const response = await fetch(`${API_URL}/api/v1/depth`, {
        method: "POST",
        body: formData,
        signal,
    });

    if (!response.ok) {
        const message = await response.text();
        throw new Error(`PHOTON Depth Engine: ${message}`);
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);

    try {
        return await decodeDepthFromUrl(objectUrl);
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
};

export const reconstructSpatialScene = async (
    imageFile: File,
    signal?: AbortSignal,
): Promise<SpatialSceneResult> => {
    const formData = new FormData();
    formData.append("file", imageFile);

    const response = await fetch(`${API_URL}/api/v1/spatial-scene`, {
        method: "POST",
        body: formData,
        signal,
    });

    if (!response.ok) {
        const message = await response.text();
        throw new Error(`PHOTON Spatial Core: ${message}`);
    }

    const payload: {
        width: number;
        height: number;
        hasLayers: boolean;
        foreground: { imageUrl: string; depthUrl: string };
        background: { imageUrl: string; depthUrl: string } | null;
    } = await response.json();

    const [fgDepth, bgDepth] = await Promise.all([
        decodeDepthFromUrl(payload.foreground.depthUrl),
        payload.background
            ? decodeDepthFromUrl(payload.background.depthUrl)
            : Promise.resolve(null),
    ]);

    return {
        width: payload.width,
        height: payload.height,
        hasLayers: payload.hasLayers,
        foreground: {
            imageUrl: payload.foreground.imageUrl,
            depthMap: fgDepth,
        },
        background:
            payload.background && bgDepth
                ? {
                    imageUrl: payload.background.imageUrl,
                    depthMap: bgDepth,
                }
                : null,
    };
};