<script lang="ts">
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import MessageSquareIcon from "@lucide/svelte/icons/message-square";
  import PlusIcon from "@lucide/svelte/icons/plus";

  import { Button } from "$lib/components/ui/button/index.js";
  import * as Sidebar from "$lib/components/ui/sidebar/index.js";
  import type { SessionListUiModel } from "$lib/projection/uiModel.js";
  import { catalogErrorCopy, sessionExcerptLabel } from "$lib/projection/uiModel.js";

  export let model: SessionListUiModel;
  export let newChatDisabled: boolean;
  export let rowsBlockedReason: string | null;
  export let lifecycleTarget: "new" | string | null;
  export let onNewChat: () => void | Promise<void>;
  export let onLoadSession: (sessionId: string) => void | Promise<void>;
  export let onRetryCatalog: () => void | Promise<void>;

  function activateNewChat(): void {
    void onNewChat();
  }

  function activateSession(sessionId: string, disabled: boolean): void {
    if (disabled) {
      return;
    }
    void onLoadSession(sessionId);
  }

  function formatActivity(value: string | null): string | null {
    if (value === null) {
      return null;
    }
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) {
      return value;
    }
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    }).format(date);
  }
</script>

<aside
  class="flex h-full min-h-0 w-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
  aria-label="Session drawer"
>
  <Sidebar.Header class="gap-3 border-b border-sidebar-border p-3">
    <div class="px-2 py-1 text-sm font-semibold tracking-tight">MoonTide</div>
    <Button
      type="button"
      class="h-10 w-full justify-start gap-2"
      disabled={newChatDisabled}
      aria-describedby={newChatDisabled && rowsBlockedReason !== null && lifecycleTarget === null
        ? "session-switch-reason"
        : undefined}
      title={newChatDisabled ? (rowsBlockedReason ?? "New Chat is unavailable") : undefined}
      onclick={activateNewChat}
    >
      {#if lifecycleTarget === "new"}
        <LoaderCircleIcon class="animate-spin" />
      {:else}
        <PlusIcon />
      {/if}
      New Chat
    </Button>
  </Sidebar.Header>

  <Sidebar.Content>
    <Sidebar.Group>
      <Sidebar.GroupLabel>Recent</Sidebar.GroupLabel>
      <Sidebar.GroupContent>
        {#if lifecycleTarget === null && rowsBlockedReason !== null && (newChatDisabled || model.rows.some((row) => !row.selected))}
          <p id="session-switch-reason" class="px-2 pb-2 text-xs text-muted-foreground">
            {rowsBlockedReason}
          </p>
        {/if}
        {#if model.status === "listing" && model.rows.length === 0}
          <div aria-label="Loading recent Sessions" aria-busy="true">
            <Sidebar.MenuSkeleton showIcon />
            <Sidebar.MenuSkeleton showIcon />
            <Sidebar.MenuSkeleton showIcon />
          </div>
        {:else if model.status === "empty" || (model.status === "ready" && model.rows.length === 0)}
          <p class="px-2 py-3 text-sm text-muted-foreground">No recent conversations.</p>
        {:else}
          <div aria-busy={model.status === "listing" || lifecycleTarget !== null}>
          <Sidebar.Menu aria-label="Recent Sessions">
            {#each model.rows as row (row.sessionId)}
              <Sidebar.MenuItem>
                <Sidebar.MenuButton
                  class="mt-session-row"
                  size="lg"
                  isActive={row.selected}
                  aria-disabled={row.selected || rowsBlockedReason !== null}
                  aria-current={row.selected ? "page" : undefined}
                  aria-describedby={!row.selected && rowsBlockedReason !== null && lifecycleTarget === null
                    ? "session-switch-reason"
                    : undefined}
                  aria-label={`${sessionExcerptLabel(row.excerpt)}${row.selected ? ", Loaded" : ""}${lifecycleTarget === row.sessionId ? ", Loading" : ""}`}
                  title={row.selected
                    ? "Current Session"
                    : (rowsBlockedReason ?? sessionExcerptLabel(row.excerpt))}
                  onclick={() => activateSession(row.sessionId, row.selected || rowsBlockedReason !== null)}
                >
                  <MessageSquareIcon />
                  <span class="flex min-w-0 flex-1 flex-col">
                    <span class="truncate">{sessionExcerptLabel(row.excerpt)}</span>
                    <span class="truncate text-xs font-normal text-muted-foreground">
                      {row.selected
                        ? "Loaded"
                        : (formatActivity(row.lastActivityAt) ?? "Saved Session")}
                    </span>
                  </span>
                </Sidebar.MenuButton>
              </Sidebar.MenuItem>
            {/each}
          </Sidebar.Menu>
          </div>
        {/if}

        {#if model.status === "failed"}
          <div class="mt-3 rounded-md border border-destructive p-2 text-sm">
            <p class="m-0 text-destructive">{catalogErrorCopy(model.error)}</p>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              class="mt-2"
              onclick={() => void onRetryCatalog()}
            >
              Retry recent Sessions
            </Button>
          </div>
        {/if}
      </Sidebar.GroupContent>
    </Sidebar.Group>
  </Sidebar.Content>

</aside>
