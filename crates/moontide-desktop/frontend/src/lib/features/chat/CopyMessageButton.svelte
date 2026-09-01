<script lang="ts">
  import CheckIcon from "@lucide/svelte/icons/check";
  import CopyIcon from "@lucide/svelte/icons/copy";

  import { Button } from "$lib/components/ui/button/index.js";

  export let text: string;
  export let label: string;

  let status: "idle" | "copied" | "failed" = "idle";

  async function copy(): Promise<void> {
    try {
      if (navigator.clipboard?.writeText === undefined) {
        throw new Error("Clipboard API unavailable");
      }
      await navigator.clipboard.writeText(text);
      status = "copied";
    } catch {
      status = "failed";
    }
  }
</script>

<Button
  type="button"
  size="icon-sm"
  variant="ghost"
  class="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 focus:opacity-100"
  aria-label={status === "copied" ? `${label} copied` : label}
  title={status === "failed" ? "Copy unavailable" : status === "copied" ? "Copied" : "Copy"}
  onclick={() => void copy()}
>
  {#if status === "copied"}
    <CheckIcon />
  {:else}
    <CopyIcon />
  {/if}
</Button>

<span class="sr-only" aria-live="polite">
  {status === "copied" ? "Copied" : status === "failed" ? "Copy unavailable" : ""}
</span>
