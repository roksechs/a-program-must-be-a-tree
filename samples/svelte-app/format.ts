// Plain TypeScript, imported from a component's <script>: proof that a
// `.svelte` file's script block resolves an ordinary cross-file import the
// same way any other TypeScript file does.
export function formatCount(n: number): string {
  return n === 1 ? "1 click" : `${n} clicks`;
}
