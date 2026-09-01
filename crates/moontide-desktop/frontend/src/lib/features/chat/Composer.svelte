<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import {
    COMPOSER_SUBMIT_KEY,
    COMPOSER_SUBMIT_MODIFIERS,
  } from "$lib/constants/index.js";
  import type { ComposerMode } from "$lib/projection/uiModel.js";

  export let value = "";
  export let mode: ComposerMode;
  export let placeholder = "Ask anything…";
  export let showStop = false;
  export let onSubmit: () => void | Promise<void>;
  export let onCancel: () => void | Promise<void>;

  let textarea: HTMLTextAreaElement | null = null;

  export function focus(): void {
    textarea?.focus();
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.isComposing || event.repeat) {
      return;
    }
    if (
      event.key === COMPOSER_SUBMIT_KEY &&
      COMPOSER_SUBMIT_MODIFIERS.some((modifier) => event[modifier])
    ) {
      event.preventDefault();
      void onSubmit();
    }
  }
</script>

<div class="rounded-xl border border-input bg-background p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring">
  <Label for="prompt" class="sr-only">Message</Label>
  <Textarea
    bind:ref={textarea}
    id="prompt"
    rows={3}
    {placeholder}
    bind:value
    class="min-h-20 resize-none border-0 bg-transparent px-2 py-2 shadow-none focus-visible:ring-0"
    disabled={mode === "disabled" || mode === "cancelling"}
    onkeydown={handleKeydown}
  />
  <div class="flex min-h-9 items-end justify-between gap-3 px-1 pb-1">
    <p class="m-0 text-xs text-muted-foreground">
      {#if mode === "disabled"}
        Connection unavailable
      {:else if mode === "active"}
        MoonTide is working
      {:else}
        Cmd/Ctrl+Enter to send
      {/if}
    </p>
    <div class="flex gap-2">
      {#if showStop}
        <Button
          type="button"
          variant="outline"
          disabled={mode !== "active"}
          onclick={() => void onCancel()}
        >
          {mode === "cancelling" ? "Cancelling" : "Stop"}
        </Button>
      {/if}
      <Button
        type="button"
        class="min-w-20"
        disabled={mode !== "editable" || value.trim().length === 0}
        onclick={() => void onSubmit()}
      >
        {mode === "submitting" ? "Sending" : "Send"}
      </Button>
    </div>
  </div>
</div>
