// Tailwind v4 integrates through @tailwindcss/vite (see vite.config.ts).
// PostCSS is not used directly; this empty config exists only so tooling that
// probes for a PostCSS config (some editors, e2e runners) finds a no-op file
// rather than warning. Tailwind v4 explicitly does NOT use a PostCSS plugin.
export default { plugins: {} };
