/**
 * Narrow Nango proxy contract injected at the app/worker boundary.
 * Keeps `@quiksend/mail` free of `@quiksend/integrations`.
 */
export interface NangoProxyClient {
  get(input: {
    endpoint: string;
    connectionId: string;
    providerConfigKey: string;
    params?: Record<string, string>;
    headers?: Record<string, string>;
  }): Promise<{ data: unknown; status: number }>;
  post(input: {
    endpoint: string;
    connectionId: string;
    providerConfigKey: string;
    data?: unknown;
    headers?: Record<string, string>;
  }): Promise<{ data: unknown; status: number }>;
}
