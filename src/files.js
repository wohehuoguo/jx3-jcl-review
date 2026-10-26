const ignoredDirectories = new Set(['node_modules','.git','System Volume Information','$RECYCLE.BIN']);

// Works with read-only FileSystemDirectoryHandle instances; no file is modified.
export async function discoverJcl(directory, {
  observed = new Map(), isCancelled = () => false, maxEntries = 30000, maxDepth = 16
} = {}) {
  const result = {files:[], pending:0, errors:0, skippedDepth:0, cancelled:false};
  let entries = 0;
  async function walk(handle, path = '', depth = 0) {
    if (isCancelled()) { result.cancelled = true; return; }
    if (depth > maxDepth) { result.skippedDepth++; return; }
    try {
      for await (const [name, child] of handle.entries()) {
        if (isCancelled()) { result.cancelled = true; return; }
        if (++entries > maxEntries) {
          const error = new Error('目录条目过多，请改选更靠近 combat_logs 的目录。');
          error.code = 'SCAN_LIMIT'; throw error;
        }
        const key = path + name;
        if (child.kind === 'directory') {
          if (!ignoredDirectories.has(name)) await walk(child, key + '/', depth + 1);
        } else if (/\.jcl\.log$/i.test(name)) result.pending++;
        else if (/\.jcl$/i.test(name)) {
          try {
            const file = await child.getFile(), signature = file.size + ':' + file.lastModified;
            if (observed.get(key) !== signature) result.files.push({file, key, signature});
          } catch { result.errors++; }
        }
      }
    } catch (error) {
      if (error.name === 'NotAllowedError' || error.code === 'SCAN_LIMIT' || handle === directory) throw error;
      result.errors++;
    }
  }
  await walk(directory);
  result.files.sort((a,b) => b.file.lastModified-a.file.lastModified || a.key.localeCompare(b.key));
  return result;
}
