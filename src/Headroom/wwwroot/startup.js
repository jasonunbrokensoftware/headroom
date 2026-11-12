// Called after Vue has applied the first account snapshot (or its error state).
// A loaded document alone does not mean WebView2 has painted anything yet.
export async function afterFirstPaint() {
  await document.fonts?.ready;
  await Promise.all([...document.images].map(image => image.decode?.().catch(() => {})));
  if (globalThis.PerformanceObserver?.supportedEntryTypes?.includes('paint') &&
      !performance.getEntriesByName('first-contentful-paint').length) {
    await new Promise(resolve => {
      const observer = new PerformanceObserver(list => {
        if (list.getEntries().some(entry => entry.name === 'first-contentful-paint')) {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe({type: 'paint', buffered: true});
    });
  }
  // Also cover DOM changes after the first paint. WebKit can use this path
  // without Paint Timing support when a Linux desktop build is added.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}
