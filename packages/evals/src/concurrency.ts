/** Run async tasks with a fixed concurrency cap (preserves result order). */
export async function runConcurrent<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  if (tasks.length === 0) {
    return [];
  }

  const workers = Math.max(1, Math.min(concurrency, tasks.length));
  const results = new Array<T>(tasks.length);
  let nextIndex = 0;

  async function _worker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= tasks.length) {
        return;
      }
      results[index] = await tasks[index]!();
    }
  }

  await Promise.all(Array.from({ length: workers }, () => _worker()));
  return results;
}
