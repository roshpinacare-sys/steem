/**
 * src/docs/swagger-ui.ts — Swagger UI HTML generator (zero-dependency, CDN-based).
 *
 * Serves an interactive API documentation page at GET /api/docs.
 * The spec is fetched from /api/openapi.yaml so the UI always reflects the
 * current deployed version without needing a rebuild.
 *
 * No external npm packages required.
 */

export function renderSwaggerUiHtml(specUrl = "/api/openapi.yaml"): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>TFA API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" crossorigin="anonymous">
  <style>
    html, body { margin: 0; padding: 0; height: 100%; }
    #swagger-ui { height: 100%; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin="anonymous"></script>
  <script>
    window.onload = function() {
      SwaggerUIBundle({
        url: "${specUrl}",
        dom_id: "#swagger-ui",
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.presets.standalone],
        layout: "BaseLayout",
        deepLinking: true,
        showExtensions: true,
        showCommonExtensions: true,
        tryItOutEnabled: true
      });
    };
  </script>
</body>
</html>`;
}
