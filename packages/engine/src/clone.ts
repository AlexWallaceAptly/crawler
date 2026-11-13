/** Deep clone for plain-JSON state (state is serialized to localStorage, so it must stay JSON-safe). */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
