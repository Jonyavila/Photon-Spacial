# PHOTON — Spatial Reality Engine

**Transforming ordinary photographs into interactive spatial experiences.**

PHOTON is an experimental spatial visualization engine designed to transform conventional 2D photographs into immersive 2.5D and 3D-like environments using AI-assisted depth estimation, Three.js and real-time rendering.

The project explores how artificial intelligence and computer graphics can work together to make photographs feel like explorable spaces rather than flat images.

**Current version:** `0.5.0`  
**Status:** Active development

---

## Overview

PHOTON analyzes a photograph, estimates its depth information and uses that data to generate a spatial representation that can be explored interactively.

The goal is to create a more immersive relationship between the viewer and the original image through depth, perspective, geometry and motion.

## Features

- **AI Depth Estimation:** Uses Depth Anything V2 to estimate relative depth from 2D photographs.
- **Spatial Reconstruction:** Converts depth information into a 3D mesh representation.
- **Interactive Exploration:** Allows users to navigate the generated scene using Three.js and camera controls.
- **Particle-Based Materialization:** Experiments with particle systems to create dynamic scene-reveal effects.
- **Adjustable Depth:** Allows depth intensity to be modified.
- **Web-Based Experience:** Built with React and TypeScript.
- **Python API:** Uses FastAPI to process images and return depth maps.

*PHOTON currently focuses on depth-based spatial visualization. It does not claim to reconstruct physically accurate geometry or unseen parts of a photograph.*

## Technology Stack

| Component | Technology |
|---|---|
| Frontend | React |
| Language | TypeScript |
| Build Tool | Vite |
| 3D Engine | Three.js |
| AI Depth Model | Depth Anything V2 Small |
| Backend | Python |
| API | FastAPI |
| Desktop Direction | Electron |

## Architecture

```text
PHOTON
│
├── Frontend
│   ├── React
│   ├── TypeScript
│   ├── Three.js
│   └── Spatial Viewport
│
├── Depth Service
│   ├── Python
│   ├── FastAPI
│   └── Depth Anything V2
│
└── Processing Pipeline
    ├── Image Input
    ├── Depth Estimation
    ├── Depth Map Processing
    ├── Spatial Geometry
    ├── Particle Animation
    └── Interactive Rendering
```

## Getting Started

### Requirements

- Node.js and npm
- Python 3.10+
- Git

### 1. Clone the repository

```bash
git clone YOUR_REPOSITORY_URL
cd photon-spatial-object
```

### 2. Install frontend dependencies

```bash
npm install
```

### 3. Configure the Python backend

```bash
cd depth-service
python -m venv .venv
```

Activate the virtual environment.

**Windows:**

```powershell
.venv\Scripts\activate
```

**Linux / macOS:**

```bash
source .venv/bin/activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

### 4. Start the depth service

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

The API will be available at:

```text
http://127.0.0.1:8000
```

API documentation:

```text
http://127.0.0.1:8000/docs
```

### 5. Start the frontend

Open another terminal in the project root:

```bash
npm run dev
```

Open the local URL provided by Vite.

## Project Structure

```text
photon-spatial-object/
│
├── depth-service/
│   ├── app/
│   │   └── main.py
│   ├── requirements.txt
│   └── .venv/
│
├── src/
│   ├── components/
│   │   ├── SpatialViewport.tsx
│   │   ├── ParticleSystem.ts
│   │   └── PhotoDropzone.tsx
│   │
│   ├── hooks/
│   │   └── usePhotoAsset.ts
│   │
│   ├── services/
│   │   └── depthApi.ts
│   │
│   ├── types/
│   └── App.tsx
│
├── package.json
└── README.md
```

## Development Roadmap

PHOTON is an evolving research and development project.

- [x] Initial web application architecture
- [x] AI-based depth estimation integration
- [x] FastAPI depth processing service
- [x] Three.js spatial visualization
- [x] Interactive camera exploration
- [x] Particle-based scene materialization
- [ ] More advanced spatial reconstruction
- [ ] Improved depth and geometry processing
- [ ] Performance optimization
- [ ] Immersive VR exploration

## Limitations

PHOTON uses monocular depth estimation. The generated depth maps represent relative depth, not necessarily real-world measurements.

The resulting spatial scenes are approximations derived from the original photograph. They do not automatically recover hidden surfaces, complete 3D objects or physically accurate environments.

## Vision

The long-term vision of PHOTON is to explore new ways of experiencing photographs through spatial computing.

Instead of simply looking at an image, the idea is to move through it, perceive its depth and interact with its visual environment.

**PHOTON — Beyond the Frame.**

---

*Developed as an independent experimental project.*