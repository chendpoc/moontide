<script lang="ts">
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";

  import type { ConversationItem } from "$lib/projection/uiModel.js";
  import {
    displayJson,
    toolResultContentText,
    toolStatusModel,
  } from "$lib/projection/uiModel.js";
  import { cn } from "$lib/utils/index.js";

  export let tool: Extract<ConversationItem, { kind: "tool" }>;

  $: status = toolStatusModel(tool.result);
  $: statusClass = cn(
    status.tone === "success" && "text-success",
    status.tone === "warning" && "text-warning",
    status.tone === "danger" && "text-destructive",
    status.tone === "neutral" && "text-muted-foreground",
  );
</script>

<details
  class={cn(
    "group rounded-lg border bg-message-tool text-sm",
    status.tone === "warning" && "border-warning/50",
    status.tone === "danger" && "border-destructive/50",
  )}
  data-tool-id={tool.call.tool_use_id}
>
  <summary class="flex cursor-pointer list-none items-center gap-2 px-3 py-2">
    <ChevronRightIcon class="size-4 shrink-0 transition-transform group-open:rotate-90" />
    <span class="min-w-0 truncate font-medium">Tool · {tool.call.name}</span>
    <span class={cn("ml-auto shrink-0 text-xs font-medium", statusClass)}>{status.label}</span>
  </summary>
  <div class="space-y-3 border-t border-border px-3 py-3">
    <div>
      <p class="mb-1 text-xs font-medium text-muted-foreground">Input</p>
      <pre class="m-0 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">{displayJson(tool.call.input)}</pre>
    </div>
    {#if tool.result !== null}
      <div>
        <p class="mb-1 text-xs font-medium text-muted-foreground">Result</p>
        <pre class="m-0 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">{toolResultContentText(tool.result)}</pre>
      </div>
    {/if}
  </div>
</details>
