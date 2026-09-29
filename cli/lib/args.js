// Minimal argv parser shared by the CLIs: positional args in `_`, `--key value`, `--flag`.
export function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith('--')) {
      const key = k.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) a[key] = true;
      else {
        a[key] = next;
        i++;
      }
    } else a._.push(k);
  }
  return a;
}
