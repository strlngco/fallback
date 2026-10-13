export async function* concatIterables<T>(...iters: AsyncIterable<T>[]): AsyncIterable<T> {
  for (const iter of iters) yield* iter;
}

export async function* teeKeys<T>(
  iter: AsyncIterable<T>,
  pick: (item: T) => string,
  into: string[],
): AsyncIterable<T> {
  for await (const item of iter) {
    into.push(pick(item));
    yield item;
  }
}
