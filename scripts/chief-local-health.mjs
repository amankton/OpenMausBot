// An exact loopback probe for the Windows startup task; no runtime data is read.
try {
  const response = await fetch('http://127.0.0.1:5299/api/health', { signal: AbortSignal.timeout(5000) });
  const body = await response.json();
  process.exit(response.ok && body.app === 'openmausbot' ? 0 : 1);
} catch (error) {
  console.error(`Chief health probe: ${error.name}`);
  process.exit(1);
}
