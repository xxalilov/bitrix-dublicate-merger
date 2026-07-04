// Resolves the Bitrix24 portal id (member_id) for API calls.
// Inside a Bitrix24 placement the BX24 SDK provides it; for local dev pass
// ?member_id=... in the URL.
export function resolveMember() {
  return new Promise((resolve) => {
    const override = new URLSearchParams(window.location.search).get('member_id');
    if (override) return resolve({ memberId: override, domain: '' });

    if (window.BX24 && typeof window.BX24.init === 'function') {
      window.BX24.init(() => {
        try {
          const auth = window.BX24.getAuth();
          resolve({ memberId: auth?.member_id || '', domain: auth?.domain || '' });
        } catch {
          resolve({ memberId: '', domain: '' });
        }
      });
    } else {
      resolve({ memberId: '', domain: '' });
    }
  });
}
