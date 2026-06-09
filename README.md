# Image Task Gallery

Frontend companion for `image-task-worker`.

## Features

- Gallery homepage for the current browser/device UUID.
- Floating prompt composer with image configuration summary and modal controls for aspect ratio and resolution.
- Configuration modal for `imageType`, Worker URL, target image API URL, key, and model.
- Browser-local device UUID and configuration persistence.
- Real task creation through the deployed Worker.
- Automatic task polling, status display, error display, and image open/download links.

## Local Development

```bash
npm install
npm run dev -- --host 127.0.0.1 --port 5174
```

Open:

```text
http://127.0.0.1:5174/
```

## Checks

```bash
npm run lint
npm run build
```

## Defaults

- Worker URL: `https://image-task-worker.royal-silence-b1e6.workers.dev`
- Target API URL: `https://sub.aizhi.site/v1/images/generations`
- Image type/model: `gpt-image-2`

The API key is intentionally empty by default and must be set in the configuration modal.
