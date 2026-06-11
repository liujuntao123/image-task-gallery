# Image Task Gallery

Frontend companion for `image-task-worker`.

## Features

- Clerk login with per-user task ownership.
- Floating prompt composer with image configuration summary and modal controls for aspect ratio and resolution.
- Fixed Worker API endpoint from Vite env/defaults.
- Image API URL, key, and model stay server-side in the Worker.
- Real task creation through the deployed Worker.
- Automatic task polling, status display, error display, and image open/download links.

## Local Development

```bash
npm install
cp .env.example .env.local
npm run dev -- --host 127.0.0.1 --port 5174
```

Open:

```text
http://127.0.0.1:5174/
```

## Checks

```bash
npm run check
```

`check` runs linting and the production build.

## Project Structure

- `src/App.tsx`: authenticated app shell and page-level orchestration.
- `src/api.ts`: Worker API client and authenticated image fetching.
- `src/appTypes.ts`: UI-specific types shared by components.
- `src/imageOptions.ts`: image size, ratio, resolution, and quality options.
- `src/utils.ts`: browser/image helpers and task formatting utilities.
- `src/components/TaskCard.tsx`: task card rendering and result-image blob URL lifecycle.
- `src/components/MaskEditorModal.tsx`: canvas-based local mask editor.

## Defaults

- Worker URL: `https://image-task-worker.royal-silence-b1e6.workers.dev`

Required env:

- `VITE_CLERK_PUBLISHABLE_KEY`: Clerk publishable key for the frontend app.
- `VITE_WORKER_URL`: optional Worker URL override. If omitted, the deployed default above is used.

The frontend no longer accepts Worker URL, target image API URL, API key, or model from users. Task ownership is derived from the Clerk session token by the Worker.
