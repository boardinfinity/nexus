import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { supabase } from "./supabase";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    return { Authorization: `Bearer ${session.access_token}` };
  }
  return {};
}

/** Fetch wrapper that includes auth headers. Use instead of raw fetch() in custom queryFn. */
export async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const authHeaders = await getAuthHeaders();
  // Auto-add Content-Type for requests with a string body (JSON)
  const contentHeaders: Record<string, string> = {};
  if (init?.body && typeof init.body === "string") {
    contentHeaders["Content-Type"] = "application/json";
  }
  return fetch(`${API_BASE}${url}`, {
    ...init,
    headers: {
      ...contentHeaders,
      ...authHeaders,
      ...init?.headers,
    },
  });
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers: {
      ...authHeaders,
      ...(data ? { "Content-Type": "application/json" } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const authHeaders = await getAuthHeaders();
    const res = await fetch(`${API_BASE}${queryKey.join("/")}`, {
      headers: authHeaders,
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
