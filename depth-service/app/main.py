import base64
from contextlib import asynccontextmanager
from io import BytesIO

import cv2
import numpy as np
import torch
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from PIL import Image, ImageOps
from torchvision.models.segmentation import (
    DeepLabV3_ResNet50_Weights,
    deeplabv3_resnet50,
)
from transformers import (
    AutoImageProcessor,
    AutoModelForDepthEstimation,
)

DEPTH_MODEL_ID = "depth-anything/Depth-Anything-V2-Small-hf"
MAX_IMAGE_SIZE = 1024
MAX_UPLOAD_BYTES = 35 * 1024 * 1024

DEVICE = (
    "cuda"
    if torch.cuda.is_available()
    else "mps"
    if torch.backends.mps.is_available()
    else "cpu"
)


def compute_normalized_depth(
    image: Image.Image,
    processor,
    model,
) -> np.ndarray:
    width, height = image.size
    inputs = processor(images=image, return_tensors="pt").to(DEVICE)

    with torch.inference_mode():
        outputs = model(**inputs)
        prediction = processor.post_process_depth_estimation(
            outputs,
            target_sizes=[(height, width)],
        )[0]["predicted_depth"]

    depth = prediction.squeeze().float().cpu().numpy()
    if depth.ndim != 2:
        depth = np.resize(depth, (height, width))

    lower = float(np.percentile(depth, 2))
    upper = float(np.percentile(depth, 98))

    if upper - lower < 1e-6:
        return np.full((height, width), 0.5, dtype=np.float32)

    return np.clip((depth - lower) / (upper - lower), 0.0, 1.0).astype(np.float32)


def detrend_aerial_depth(depth: np.ndarray) -> np.ndarray:
    """
    Elimina la inclinación vertical artificial en fotos aéreas/satelitales
    para que las calles y canchas queden niveladas y solo sobresalgan los edificios.
    """
    h, w = depth.shape
    if h < 4 or w < 4:
        return depth.astype(np.float32)

    y_norm = np.linspace(0.0, 1.0, h, dtype=np.float32)
    row_medians = np.median(depth, axis=1).astype(np.float32)

    y_mean = float(np.mean(y_norm))
    m_mean = float(np.mean(row_medians))
    denom = float(np.sum((y_norm - y_mean) ** 2))

    if denom > 1e-6:
        slope = float(np.sum((y_norm - y_mean) * (row_medians - m_mean))) / denom
        intercept = m_mean - slope * y_mean
        trend = (slope * y_norm[:, None] + intercept).astype(np.float32)
        detrended = depth - trend
    else:
        detrended = depth.copy()

    detrended = cv2.GaussianBlur(detrended, (9, 9), 0)

    lower = float(np.percentile(detrended, 3))
    upper = float(np.percentile(detrended, 97))
    if upper - lower < 1e-6:
        return np.full((h, w), 0.5, dtype=np.float32)

    return np.clip((detrended - lower) / (upper - lower), 0.0, 1.0).astype(np.float32)


def extract_spatial_layers(
    image: Image.Image,
    full_depth: np.ndarray,
    seg_model,
    seg_transform,
) -> tuple[Image.Image, np.ndarray, bool, str]:
    """
    Clasifica la escena en:
    - 'subject': Retrato u objeto reconocible -> 2 capas + inpainting.
    - 'aerial': Vista aérea / mapa cenital -> 1 malla nivelada sin inpainting.
    - 'landscape': Paisaje terrestre abierto -> 2 capas por profundidad.
    """
    width, height = image.size
    rgb_np = np.array(image)

    input_tensor = seg_transform(image).unsqueeze(0).to(DEVICE)
    with torch.inference_mode():
        output = seg_model(input_tensor)["out"][0]

    probs = torch.softmax(output, dim=0)
    semantic_fg = (1.0 - probs[0]).cpu().numpy()
    semantic_fg = cv2.resize(semantic_fg, (width, height), interpolation=cv2.INTER_LINEAR)

    semantic_ratio = float(np.mean(semantic_fg > 0.5))
    is_semantic_subject = 0.04 <= semantic_ratio <= 0.90

    if is_semantic_subject:
        gc_mask = np.full((height, width), cv2.GC_PR_BGD, dtype=np.uint8)
        gc_mask[semantic_fg > 0.65] = cv2.GC_FGD
        gc_mask[(semantic_fg > 0.18) & (semantic_fg <= 0.65)] = cv2.GC_PR_FGD
        gc_mask[semantic_fg < 0.04] = cv2.GC_BGD

        if int(np.sum(gc_mask == cv2.GC_FGD)) > 50 and int(np.sum(gc_mask == cv2.GC_BGD)) > 50:
            bgr_np = cv2.cvtColor(rgb_np, cv2.COLOR_RGB2BGR)
            bgd_model = np.zeros((1, 65), np.float64)
            fgd_model = np.zeros((1, 65), np.float64)
            try:
                cv2.grabCut(
                    bgr_np,
                    gc_mask,
                    None,
                    bgd_model,
                    fgd_model,
                    3,
                    cv2.GC_INIT_WITH_MASK,
                )
                binary_mask = np.where(
                    (gc_mask == cv2.GC_FGD) | (gc_mask == cv2.GC_PR_FGD),
                    255,
                    0,
                ).astype(np.uint8)
            except cv2.error:
                binary_mask = (semantic_fg > 0.5).astype(np.uint8) * 255
        else:
            binary_mask = (semantic_fg > 0.5).astype(np.uint8) * 255

        close_kernel = np.ones((7, 7), np.uint8)
        binary_mask = cv2.morphologyEx(binary_mask, cv2.MORPH_CLOSE, close_kernel)
        alpha_mask = cv2.GaussianBlur(binary_mask, (5, 5), 0)
        rgba_np = np.dstack((rgb_np, alpha_mask))
        return Image.fromarray(rgba_np, mode="RGBA"), alpha_mask, True, "subject"

    # Detección de mapa aéreo / cenital
    gray = cv2.cvtColor(rgb_np, cv2.COLOR_RGB2GRAY)
    top_band = gray[: max(1, int(height * 0.15)), :]
    top_texture = float(np.std(top_band))
    edges = cv2.Canny(gray, 80, 180)
    edge_density = float(np.mean(edges > 0))

    if top_texture > 28.0 and edge_density > 0.08:
        empty_mask = np.zeros((height, width), dtype=np.uint8)
        return image.convert("RGBA"), empty_mask, False, "aerial"

    # Paisaje terrestre abierto
    split_level = float(np.percentile(full_depth, 52))
    soft_band = 0.08
    soft_fg = np.clip(
        (full_depth - (split_level - soft_band)) / (soft_band * 2.0),
        0.0,
        1.0,
    )
    alpha_mask = (soft_fg * 255).astype(np.uint8)
    alpha_mask = cv2.GaussianBlur(alpha_mask, (11, 11), 0)

    fg_ratio = float(np.mean(alpha_mask > 128))
    has_layers = bool(0.03 <= fg_ratio <= 0.95)
    rgba_np = np.dstack((rgb_np, alpha_mask))
    return Image.fromarray(rgba_np, mode="RGBA"), alpha_mask, has_layers, "landscape"


def array_to_png_base64(arr: np.ndarray, mode: str = "L") -> str:
    pil_img = Image.fromarray(arr, mode=mode)
    buf = BytesIO()
    pil_img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("utf-8")


def pil_to_png_base64(pil_img: Image.Image) -> str:
    buf = BytesIO()
    pil_img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("utf-8")


@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"[PHOTON] Loading Depth model: {DEPTH_MODEL_ID} on {DEVICE}")
    processor = AutoImageProcessor.from_pretrained(DEPTH_MODEL_ID)
    depth_model = AutoModelForDepthEstimation.from_pretrained(DEPTH_MODEL_ID)
    depth_model.to(DEVICE)
    depth_model.eval()

    print("[PHOTON] Loading Segmentation model: DeepLabV3-ResNet50")
    seg_weights = DeepLabV3_ResNet50_Weights.DEFAULT
    seg_model = deeplabv3_resnet50(weights=seg_weights)
    seg_model.to(DEVICE)
    seg_model.eval()

    app.state.processor = processor
    app.state.depth_model = depth_model
    app.state.seg_model = seg_model
    app.state.seg_transform = seg_weights.transforms()

    print("[PHOTON] Spatial Core v0.5.1 (Subject + Aerial + Landscape) ready")

    yield

    del app.state.depth_model
    del app.state.processor
    del app.state.seg_model

    if DEVICE == "cuda":
        torch.cuda.empty_cache()


app = FastAPI(
    title="PHOTON Spatial Core",
    version="0.5.1",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {
        "status": "online",
        "service": "PHOTON Spatial Core",
        "version": "0.5.1",
        "docs": "/docs",
        "health": "/health",
    }


@app.get("/health")
async def health():
    return {
        "status": "online",
        "service": "PHOTON Spatial Core",
        "version": "0.5.1",
        "device": DEVICE,
    }


def validate_and_load_image(image_bytes: bytes) -> Image.Image:
    if len(image_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail="La imagen supera el límite de 35 MB.",
        )

    image = Image.open(BytesIO(image_bytes))
    image = ImageOps.exif_transpose(image).convert("RGB")

    if image.width < 2 or image.height < 2:
        raise ValueError("Imagen demasiado pequeña.")

    image.thumbnail((MAX_IMAGE_SIZE, MAX_IMAGE_SIZE), Image.Resampling.LANCZOS)
    return image


@app.post("/api/v1/depth")
async def estimate_depth(
    request: Request,
    file: UploadFile = File(...),
):
    if file.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(status_code=415, detail="Formato no soportado.")

    try:
        image_bytes = await file.read(MAX_UPLOAD_BYTES + 1)
        image = validate_and_load_image(image_bytes)

        normalized = compute_normalized_depth(
            image,
            request.app.state.processor,
            request.app.state.depth_model,
        )

        depth_image = Image.fromarray((normalized * 255).astype(np.uint8), mode="L")
        output = BytesIO()
        depth_image.save(output, format="PNG")
        output.seek(0)

        return StreamingResponse(
            output,
            media_type="image/png",
            headers={
                "X-Depth-Width": str(image.width),
                "X-Depth-Height": str(image.height),
                "Cache-Control": "no-store",
            },
        )
    except HTTPException:
        raise
    except Exception as error:
        print(f"[PHOTON] Depth estimation failed: {error}")
        raise HTTPException(status_code=500, detail=str(error)) from error


@app.post("/api/v1/spatial-scene")
async def reconstruct_spatial_scene(
    request: Request,
    file: UploadFile = File(...),
):
    if file.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(status_code=415, detail="Formato no soportado.")

    try:
        image_bytes = await file.read(MAX_UPLOAD_BYTES + 1)
        image = validate_and_load_image(image_bytes)
        width, height = image.size

        processor = request.app.state.processor
        depth_model = request.app.state.depth_model
        seg_model = request.app.state.seg_model
        seg_transform = request.app.state.seg_transform

        full_depth = compute_normalized_depth(image, processor, depth_model)

        fg_rgba, alpha_mask, has_layers, scene_type = extract_spatial_layers(
            image,
            full_depth,
            seg_model,
            seg_transform,
        )

        if scene_type == "aerial":
            full_depth = detrend_aerial_depth(full_depth)

        if not has_layers:
            return JSONResponse(
                {
                    "width": width,
                    "height": height,
                    "hasLayers": False,
                    "sceneType": scene_type,
                    "foreground": {
                        "imageUrl": "",
                        "depthUrl": array_to_png_base64((full_depth * 255).astype(np.uint8)),
                    },
                    "background": None,
                }
            )

        dilation_px = max(14, int(min(width, height) * 0.03))
        kernel = np.ones((dilation_px, dilation_px), np.uint8)
        dilated_mask = cv2.dilate(
            (alpha_mask > 90).astype(np.uint8) * 255,
            kernel,
            iterations=1,
        )

        rgb_np = np.array(image)
        bgr_np = cv2.cvtColor(rgb_np, cv2.COLOR_RGB2BGR)
        inpainted_bgr = cv2.inpaint(
            bgr_np,
            dilated_mask,
            inpaintRadius=11,
            flags=cv2.INPAINT_TELEA,
        )
        inpainted_bg = Image.fromarray(cv2.cvtColor(inpainted_bgr, cv2.COLOR_BGR2RGB))

        bg_depth = compute_normalized_depth(inpainted_bg, processor, depth_model)
        bg_depth_pushed = np.clip(bg_depth * 0.88, 0.0, 1.0)

        return JSONResponse(
            {
                "width": width,
                "height": height,
                "hasLayers": True,
                "sceneType": scene_type,
                "foreground": {
                    "imageUrl": pil_to_png_base64(fg_rgba),
                    "depthUrl": array_to_png_base64((full_depth * 255).astype(np.uint8)),
                },
                "background": {
                    "imageUrl": pil_to_png_base64(inpainted_bg),
                    "depthUrl": array_to_png_base64((bg_depth_pushed * 255).astype(np.uint8)),
                },
            }
        )

    except HTTPException:
        raise
    except Exception as error:
        print(f"[PHOTON] Spatial scene reconstruction failed: {error}")
        raise HTTPException(
            status_code=500,
            detail="No se pudo reconstruir la escena espacial.",
        ) from error