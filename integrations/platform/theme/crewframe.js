(() => {
  if (window.parent === window) return;
  // These selectors identify label chips in the pinned workspace build, not code/math tags.
  const chips = '.tag.svelte-x9hfx6, .tag-item.svelte-zplcz5';
  const prepareTags = (root) => {
    const elements = [...(root.matches?.(chips) ? [root] : []), ...root.querySelectorAll(chips)];
    for (const chip of elements) {
      const color = chip.style.getPropertyValue('--tag-color') || chip.style.color || chip.style.backgroundColor;
      if (color && chip.style.getPropertyValue('--papra-tag-color') !== color) chip.style.setProperty('--papra-tag-color', color);
    }
  };
  if (document.body && typeof MutationObserver !== 'undefined') {
    prepareTags(document.body);
    new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'attributes') { if (record.target.matches(chips)) prepareTags(record.target); }
        else for (const node of record.addedNodes) { if (node.nodeType === 1) prepareTags(node); }
      }
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  }
  const origins = ['http://127.0.0.1:5299', 'http://localhost:5299'];
  window.addEventListener('message', event => {
    if (event.source !== window.parent || !origins.includes(event.origin) || event.data?.type !== 'crewframe:theme') return;
    if (![null, 'light', 'dark'].includes(event.data.mode)) return;
    for (const [key, variable] of [['accent', '--cf-custom-accent'], ['ink', '--cf-custom-ink']]) {
      const value = event.data[key];
      if (typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)) document.documentElement.style.setProperty(variable, value);
      else document.documentElement.style.removeProperty(variable);
    }
    if (event.data.mode === 'light' || event.data.mode === 'dark') document.documentElement.dataset.crewframeSkin = event.data.mode;
    else if (event.data.mode === null) delete document.documentElement.dataset.crewframeSkin;
  });
  for (const origin of origins) window.parent.postMessage({ type: 'crewframe:theme-ready' }, origin);
})();
