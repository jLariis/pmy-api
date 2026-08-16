/**
 * Limitador de concurrencia mínimo (equivalente a p-limit para nuestro uso), sin
 * dependencias externas. Evita acoplar el motor a un paquete ESM que jest no transpila.
 * `limit(fn)` encola `fn` y garantiza que a lo sumo `concurrency` corran a la vez.
 */
export function createLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  const drain = () => {
    while (active < concurrency && queue.length > 0) {
      active++;
      const run = queue.shift()!;
      run();
    }
  };

  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            drain();
          });
      };
      queue.push(run);
      drain();
    });
  };
}
