/**
 * Defers creating a module-level singleton until first use, so importing a module (as `next build`
 * does while collecting page data) needs no environment. Functions keep their `this`; the `in`
 * operator and calls are forwarded to the real value.
 */
export function lazy<T extends object>(create: () => T): T {
  let real: T | undefined;
  const get = () => (real ??= create());
  return new Proxy(function target() {} as unknown as T, {
    get(_t, prop) {
      const value = Reflect.get(get(), prop, get());
      return typeof value === "function"
        ? (value as (...a: unknown[]) => unknown).bind(get())
        : value;
    },
    has: (_t, prop) => prop in get(),
    apply: (_t, thisArg, args) =>
      Reflect.apply(get() as unknown as (...a: unknown[]) => unknown, thisArg, args),
    set: (_t, prop, value) => Reflect.set(get(), prop, value),
  });
}
