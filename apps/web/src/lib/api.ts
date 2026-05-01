import { env } from "@test-evals/env/web";

export function apiBase() {
  return env.NEXT_PUBLIC_SERVER_URL.replace(/\/$/, "");
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${t}`);
  }
  return res.json() as Promise<T>;
}
