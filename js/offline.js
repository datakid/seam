export function registerOffline() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext || window.self !== window.top) return;
  const start = () => {
    navigator.serviceWorker.register(new URL('../sw.js', import.meta.url)).catch(() => {});
  };
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}
