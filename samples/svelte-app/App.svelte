<script lang="ts">
  import Counter from "./Counter.svelte";

  // A component-to-component reference (`<Counter ...>` below): resolving
  // this to the *other file's* declaration, not just naming the import, is
  // the reason this analyzer runs the real svelte2tsx transform instead of
  // only reading each file's <script> block on its own.
  let step = 2;
</script>

<h1>Counters</h1>
<Counter />
<Counter {step} />
