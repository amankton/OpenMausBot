// Applied synchronously in <head>, before the nested workspace's own loader.
// Only the fixed light/dark frame hint is used; no identity or content crosses.
if (window.parent !== window && /^crewframe-(light|dark)$/.test(window.name)) {
  const mode = window.name === 'crewframe-light' ? 'light' : 'dark';
  document.documentElement.dataset.crewframeSkin = mode;
  document.documentElement.style.backgroundColor = mode === 'light' ? '#ffffff' : '#18181b';
  document.documentElement.style.colorScheme = mode;
}
