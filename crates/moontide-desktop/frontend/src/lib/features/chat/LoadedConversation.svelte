<script lang="ts">
  import { afterUpdate } from "svelte";

  import { Button } from "$lib/components/ui/button/index.js";
  import type { RenderState } from "$lib/projection/renderState.js";
  import {
    conversationItems,
    liveTools,
    orderedDrafts,
    runStateKind,
    type ConversationItem,
  } from "$lib/projection/uiModel.js";

  import ApprovalBlock from "./ApprovalBlock.svelte";
  import AssistantMessage from "./AssistantMessage.svelte";
  import NoticeBlock from "./NoticeBlock.svelte";
  import ToolBlock from "./ToolBlock.svelte";
  import UserMessage from "./UserMessage.svelte";

  export let state: RenderState;
  export let approvalEnabled: boolean;
  export let approvalTarget: string | null;
  export let onResolveApproval: (
    approvalId: string,
    approve: boolean,
  ) => void | Promise<void>;

  const BOTTOM_THRESHOLD = 64;

  let viewport: HTMLDivElement | null = null;
  let detached = false;
  let previousContentVersion: string | null = null;

  $: items = conversationItems(state);
  $: drafts = orderedDrafts(state);
  $: liveToolItems = liveTools(state).map(
    (tool): Extract<ConversationItem, { kind: "tool" }> => ({
      kind: "tool",
      key: `live-tool:${tool.call.tool_use_id}`,
      turn: tool.turn,
      call: tool.call,
      result: tool.result,
    }),
  );
  $: approvals = Object.values(state.approvals).sort(
    (left, right) =>
      left.request.turn - right.request.turn ||
      left.request.id.localeCompare(right.request.id),
  );
  $: interrupted = runStateKind(state.run) === "failed";
  $: contentVersion = readingContentVersion(state);

  afterUpdate(() => {
    if (contentVersion === previousContentVersion) {
      return;
    }
    if (previousContentVersion === null || !detached) {
      scrollToLatest();
    }
    previousContentVersion = contentVersion;
  });

  function handleScroll(): void {
    if (viewport === null) {
      return;
    }
    const distanceFromBottom =
      viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
    detached = distanceFromBottom > BOTTOM_THRESHOLD;
  }

  function scrollToLatest(): void {
    if (viewport === null) {
      return;
    }
    viewport.scrollTop = viewport.scrollHeight;
    detached = false;
  }

  function readingContentVersion(current: RenderState): string {
    const messages = current.messages.map((message) => {
      switch (message.kind) {
        case "user":
          return `u:${message.turn}:${message.text.length}`;
        case "assistant":
          return `a:${message.turn}:${JSON.stringify(message.blocks).length}`;
        case "tool_call":
          return `tc:${message.call.tool_use_id}`;
        case "tool_result":
          return `tr:${message.result.tool_use_id}:${JSON.stringify(message.result.status)}`;
      }
    });
    const draftVersions = Object.values(current.assistantDrafts).map(
      (draft) => `${draft.turn}:${draft.llmCallId}:${draft.updateIndex}`,
    );
    const toolVersions = Object.values(current.tools).map(
      (tool) =>
        `${tool.call.tool_use_id}:${tool.result === null ? "running" : JSON.stringify(tool.result.status)}`,
    );
    return [
      ...messages,
      ...draftVersions,
      ...toolVersions,
      ...Object.keys(current.approvals),
      ...current.notices.map((notice) => `${notice.kind}:${notice.message}`),
    ].join("|");
  }
</script>

<div class="relative min-h-0 flex-1">
  <div
    bind:this={viewport}
    class="h-full overflow-y-auto overscroll-contain"
    role="region"
    aria-label="Conversation"
    onscroll={handleScroll}
  >
    <section class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      {#if items.length === 0 && drafts.length === 0 && liveToolItems.length === 0 && approvals.length === 0 && state.notices.length === 0}
        <p class="py-12 text-center text-sm text-muted-foreground">
          This Session has no messages yet.
        </p>
      {/if}

      {#each items as item (item.key)}
        {#if item.kind === "user"}
          <UserMessage text={item.text} />
        {:else if item.kind === "assistant"}
          <AssistantMessage blocks={item.blocks} />
        {:else}
          <ToolBlock tool={item} />
        {/if}
      {/each}

      {#each drafts as draft (`${draft.turn}:${draft.llmCallId}`)}
        <AssistantMessage
          blocks={draft.snapshot.content}
          pending={draft.snapshot.pending}
          streaming={!interrupted}
          {interrupted}
        />
      {/each}

      {#each liveToolItems as tool (tool.key)}
        <ToolBlock {tool} />
      {/each}

      {#each approvals as approval (approval.request.id)}
        <ApprovalBlock
          {approval}
          enabled={approvalEnabled}
          resolving={approvalTarget === approval.request.id}
          onResolve={onResolveApproval}
        />
      {/each}

      {#each state.notices as notice}
        <NoticeBlock {notice} />
      {/each}

      <div class="h-px" aria-hidden="true"></div>
    </section>
  </div>

  {#if detached}
    <Button
      type="button"
      size="sm"
      variant="outline"
      class="absolute bottom-3 left-1/2 -translate-x-1/2 bg-background shadow-sm"
      onclick={scrollToLatest}
    >
      Jump to latest
    </Button>
  {/if}
</div>
