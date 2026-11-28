/**
 * Authentication through the backend-for-frontend (ADR-026): the session
 * lives in an HTTP-only cookie and the BFF holds the tokens, so nothing
 * here touches a token or browser storage.
 */
export { BffAuthProvider as AuthProvider, useBffAuth as useAuth, type BffAuthValue as AuthContextValue } from '@revelation-srs/ui';
