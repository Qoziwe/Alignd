# Frontend

React + Vite client for Alignd. This application handles authentication screens, analysis form submission, result rendering, and navigation through saved reports.

## Responsibilities

- register and login forms
- token storage in the browser
- profile analysis submission
- error rendering from the real API
- recent analyses list
- reopening saved reports

## UI flow

```mermaid
flowchart LR
    H[Home screen] --> A[Auth]
    H --> F[Analysis form]
    A --> F
    F --> L[Loading screen]
    L --> R[Results screen]
    H --> S[Recent analyses]
    S --> R
```

## Stack

| Area | Tooling |
| --- | --- |
| App | React 19 |
| Bundler | Vite |
| Styling | Tailwind CSS |
| Icons | lucide-react |
| Type safety | TypeScript |

## Environment

Create `frontend/.env`:

```env
VITE_API_URL=http://127.0.0.1:5000
```

Production example:

```env
VITE_API_URL=https://your-domain.com/api
```

## Commands

```bash
cd frontend
npm install
npm run dev
npm run lint
npm run test
npm run build
```

## Build output

The production bundle is generated in:

```text
frontend/dist
```

That folder should be served by Nginx or another static file server.

## Production notes

- Set `VITE_API_URL` before running `npm run build`
- Rebuild the frontend after every environment change
- If you deploy frontend and backend on the same domain, prefer `/api` proxying through Nginx
- If the app loads but API requests fail, verify the built frontend points to the correct API base URL

For the full server deployment guide, see the root [README](../README.md).
