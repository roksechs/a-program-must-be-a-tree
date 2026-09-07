<script lang="ts">
  import { formatCount } from "./format";

  export let step = 1;
  let count = 0;

  function increment() {
    count += step;
  }

  function reset() {
    count = 0;
  }
</script>

<!-- Both handlers below and the {formatCount(count)} call in the template
     are real references the analyzer traces through svelte2tsx's transform,
     not just the <script> block: docs/DESIGN.md's "Analyzing Svelte
     components" explains why that distinction matters. -->
<button on:click={increment}>{formatCount(count)}</button>
<button on:click={reset}>reset</button>
