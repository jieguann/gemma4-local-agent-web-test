# Gemma Web Local Chat

Small Vite app for chatting with a local Gemma model in the browser using the MediaPipe LLM Inference Web API.

## Setup

```bash
npm install
```

### Download a model

Model files are not included in the repo. Download a browser-optimized Gemma 4 `.task` file and place it in `public/assets/`.

**Recommended models** (from the Google AI Edge / LiteRT Hugging Face community):

| Model | File | Link |
|-------|------|------|
| Gemma 4 E2B | `gemma-4-E2B-it-web.task` | [Hugging Face](https://huggingface.co/litert-community/gemma-4-E2B-it-web) |
| Gemma 4 E4B | `gemma-4-E4B-it-web.task` | [Hugging Face](https://huggingface.co/litert-community/gemma-4-E4B-it-web) |

Place the downloaded file so the path is:

```
public/assets/gemma-4-E2B-it-web.task
```

The app loads this path by default on startup. You can also use the file picker in the UI to load a different model at runtime.

## Run

```bash
npm run dev
```

Open the local Vite URL in a Chromium-based browser with WebGPU support. The model loads automatically on page load.

## Notes

- Uses `@mediapipe/tasks-genai` for inference
- WASM assets are loaded from the jsDelivr CDN
- All inference runs locally in the browser — nothing is sent to an external API
