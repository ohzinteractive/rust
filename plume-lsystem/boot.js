/* External loader: safe under a script-src 'self' Content Security Policy. */
(async () => {
  const panel = document.getElementById('controlPanel');
  const toggle = document.getElementById('toggleControls');
  function setControlsVisible(visible) {
    panel?.classList.toggle('collapsed', !visible);
    if (toggle) {
      toggle.textContent = visible ? 'Hide controls −' : 'Show controls +';
      toggle.setAttribute('aria-expanded', String(visible));
    }
  }
  setControlsVisible(!window.matchMedia('(max-width: 760px)').matches);
  toggle?.addEventListener('click', () => setControlsVisible(panel.classList.contains('collapsed')));

  const params = new URLSearchParams(location.search);
  const requested = params.get('renderer');
  // Restricted iframe previews commonly disallow CDN modules, so start there
  // with the same interactive L-system drawn by a dependency-free renderer.
  const embedded = window.self !== window.top;
  const useCanvas = requested === 'canvas' || (embedded && requested !== 'three');

  async function startCanvas() {
    // A failed WebGL initialization may have locked the canvas context type.
    const original = document.getElementById('scene');
    if (original) original.replaceWith(original.cloneNode(false));
    await import('./fallback.js');
    document.documentElement.dataset.renderer = 'canvas2d-fallback';
  }
  try {
    if (useCanvas) {
      await startCanvas();
    } else {
      try {
        await import('./three-scene.js');
        document.documentElement.dataset.renderer = 'threejs';
      } catch (error) {
        console.info('Three.js unavailable; switching to the local 2D feather renderer.', error);
        await startCanvas();
      }
    }
  } catch (error) {
    console.error('No renderer was available:', error);
    const loading = document.getElementById('loading');
    if (loading) loading.textContent = 'Rendering unavailable — run through a local HTTP server.';
  }
})();
