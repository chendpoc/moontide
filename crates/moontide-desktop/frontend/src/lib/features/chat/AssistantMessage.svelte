<script lang="ts">
  import type {
    AssistantDisplayBlock,
    AssistantPendingBlock,
  } from "$lib/projection/uiModel.js";
  import {
    assistantCopyText,
    contentBlockDisplayText,
    displayJson,
  } from "$lib/projection/uiModel.js";

  import CopyMessageButton from "./CopyMessageButton.svelte";

  export let blocks: AssistantDisplayBlock[];
  export let pending: AssistantPendingBlock = null;
  export let streaming = false;
  export let interrupted = false;

  $: copyText = assistantCopyText(blocks, pending);
</script>

<article
  class="group relative min-w-0 pr-10 leading-7"
  data-message-kind="assistant"
  data-streaming={streaming}
>
  {#if streaming}
    <p class="sr-only">Streaming response</p>
  {:else if interrupted}
    <p class="mb-2 text-xs font-medium text-muted-foreground">
      Interrupted response
    </p>
  {/if}

  <div class="space-y-3">
    {#each blocks as block}
      {#if block.kind === "text"}
        <p class="m-0 whitespace-pre-wrap break-words">{block.text}</p>
      {:else if block.kind === "thinking"}
        <details class="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
          <summary class="cursor-pointer font-medium text-muted-foreground">Thinking</summary>
          <p class="mb-0 mt-2 whitespace-pre-wrap text-muted-foreground">{block.thinking}</p>
        </details>
      {:else if block.kind === "tool_use"}
        <details class="rounded-lg border border-border bg-message-tool px-3 py-2 text-sm">
          <summary class="cursor-pointer font-medium">Tool call · {block.name}</summary>
          <pre class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">{displayJson(block.input)}</pre>
        </details>
      {:else}
        <details class="rounded-lg border border-border bg-message-tool px-3 py-2 text-sm">
          <summary class="cursor-pointer font-medium">Tool result</summary>
          <pre class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">{contentBlockDisplayText(block.content)}</pre>
        </details>
      {/if}
    {/each}

    {#if pending?.kind === "text"}
      <p class="m-0 whitespace-pre-wrap break-words">{pending.text}</p>
    {:else if pending?.kind === "thinking"}
      <details class="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
        <summary class="cursor-pointer font-medium text-muted-foreground">Thinking</summary>
        <p class="mb-0 mt-2 whitespace-pre-wrap text-muted-foreground">{pending.thinking}</p>
      </details>
    {:else if pending?.kind === "tool_use"}
      <details class="rounded-lg border border-border bg-message-tool px-3 py-2 text-sm">
        <summary class="cursor-pointer font-medium">Tool call · {pending.name} · streaming</summary>
        <pre class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">{pending.input_json}</pre>
      </details>
    {/if}
  </div>

  {#if copyText.length > 0}
    <div class="absolute right-0 top-0">
      <CopyMessageButton text={copyText} label="Copy assistant message" />
    </div>
  {/if}
</article>
