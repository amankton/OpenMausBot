// Host headroom is a local build policy, separate from Node's heap cap.
export function frontendMemoryPolicy(heapLimitMiB, { constrained = false } = {}) {
  if (!Number.isFinite(heapLimitMiB) || heapLimitMiB <= 0 || heapLimitMiB > 2752) {
    throw Error('Use a bounded frontend heap of at most 2560 MiB old space.');
  }
  if (constrained && heapLimitMiB > 2240) {
    throw Error('Constrained memory mode requires at most 2048 MiB old space.');
  }
  return {
    profile: constrained ? 'constrained' : 'standard',
    minimumStartMiB: constrained ? 4096 : heapLimitMiB > 2240 ? 5120 : heapLimitMiB > 1728 ? 4608 : 3584,
    minimumRunningMiB: constrained ? 1280 : 2048,
  };
}
