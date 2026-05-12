/// <reference types="vite/client" />

// React 19 + the new JSX transform: `JSX.Element` is no longer in the React
// namespace by default, but our App.tsx (and any future component that names
// the return type) keeps the legacy global ergonomics by re-declaring it
// here. This is a development-time type only — it does not emit any runtime
// JS.
declare namespace JSX {
  type Element = import("react").ReactElement;
}
