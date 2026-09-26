import type { ApiErrorCode, ProviderStatus } from '@lfc/contracts';
import {
  ApiError,
  CheckClaimAccepted,
  ProviderStatus as ProviderStatusSchema,
} from '@lfc/contracts';

const headers = (token: string) => ({
  authorization: `Bearer ${token}`,
  'content-type': 'application/json',
});

export type CheckResult =
  | { readonly ok: true; readonly claimId: string }
  | { readonly ok: false; readonly code: ApiErrorCode };

async function errorCode(response: Response): Promise<ApiErrorCode> {
  try {
    const parsed = ApiError.safeParse(await response.json());
    return parsed.success ? parsed.data.error.code : 'internal';
  } catch {
    return 'internal';
  }
}

/** `POST /api/claims/check` (text mode, brief 6.8). The token goes in the header, never the URL. */
export async function checkClaim(
  gatewayUrl: string,
  token: string,
  sessionId: string,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CheckResult> {
  try {
    const response = await fetchImpl(`${gatewayUrl}/claims/check`, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify({ schemaVersion: 1, sessionId, text }),
    });
    if (response.status !== 202) return { ok: false, code: await errorCode(response) };
    const accepted = CheckClaimAccepted.safeParse(await response.json());
    return accepted.success
      ? { ok: true, claimId: accepted.data.claimId }
      : { ok: false, code: 'internal' };
  } catch {
    return { ok: false, code: 'internal' };
  }
}

/** `GET /api/status` for the settings page (brief 11, 15.6). */
export async function fetchProviderStatus(
  gatewayUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderStatus | null> {
  try {
    const response = await fetchImpl(`${gatewayUrl}/status`, { headers: headers(token) });
    if (!response.ok) return null;
    const parsed = ProviderStatusSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
