# Templates (V225)

Each subdirectory is a minimal, copy-able starter. `GET /templates` returns the manifest list; `GET /templates/:name` returns a single manifest. Copying the files into a project workspace is the responsibility of the agent (via the `write_file` tool) or a future `POST /templates/:name/scaffold/:projectId` endpoint.

## vite-react-shadcn

Vite + React 19 + Tailwind v4 baseline. The starter intentionally ships **without** shadcn components — the agent installs them on demand to keep the seed lean. Design tokens belong in `src/styles.css`; never hard-code colors in components.
