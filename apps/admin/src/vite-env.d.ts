/// <reference types="vite/client" />

// ADR-026: the app calls only its own origin (/bff/...); the BFF holds the tokens.
interface ImportMetaEnv {
  /** 'false' hides the single sign-on button where no Keycloak runs. */
  readonly VITE_SSO?:       string;
  readonly VITE_DEV_AUTH?:  string;
  readonly VITE_DEMO_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
