export function injectPWAManifest() {
  if (typeof window === 'undefined') return;

  if (!document.querySelector('link[rel="manifest"]')) {
    const manifest = {
      name: "ZELO — Cuidado Compartilhado",
      short_name: "ZELO",
      theme_color: "#6e9b7f",
      background_color: "#faf9f7",
      display: "standalone",
      icons: [
        {
          src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%236e9b7f' rx='20'/%3E%3Ctext x='50' y='50' fill='white' font-size='40' font-family='sans-serif' text-anchor='middle' dominant-baseline='central'%3EZ%3C/text%3E%3C/svg%3E",
          sizes: "192x192",
          type: "image/svg+xml",
          purpose: "any maskable"
        }
      ]
    };
    const stringManifest = JSON.stringify(manifest);
    const blob = new Blob([stringManifest], {type: 'application/json'});
    const manifestURL = URL.createObjectURL(blob);
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = manifestURL;
    document.head.appendChild(link);
  }

  if (!document.querySelector('meta[name="theme-color"]')) {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = '#6e9b7f';
    document.head.appendChild(meta);
  }
}