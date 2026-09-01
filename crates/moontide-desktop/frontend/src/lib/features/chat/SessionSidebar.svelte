<script lang="ts">
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import MessageSquareIcon from "@lucide/svelte/icons/message-square";
  import PlusIcon from "@lucide/svelte/icons/plus";

  import { Button } from "$lib/components/ui/button/index.js";
  import * as Sidebar from "$lib/components/ui/sidebar/index.js";
  import type { ConnectionState } from "$lib/controller/index.js";
  import { connectionLabel, type SessionListUiModel } from "$lib/projection/uiModel.js";

  export let model: SessionListUiModel;
  export let connection: ConnectionState;
  export let newChatDisabled: boolean;
  export let rowsDisabled: boolean;
  export let lifecycleTarget: "new" | string | null;
  export let onNewChat: () => void | Promise<void>;
  export let onLoadSession: (sessionId: string) => void | Promise<void>;
  export let onRetryCatalog: () => void | Promise<void>;

  const sidebar = Sidebar.useSidebar();

  function activateNewChat(): void {
    sidebar.setOpenMobile(false);
    void onNewChat();
  }

  function activateSession(sessionId: string, disabled: boolean): void {
    if (disabled) {
      return;
    }
    sidebar.setOpenMobile(false);
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

<Sidebar.Root collapsible="offcanvas" aria-label="Session sidebar">
  <Sidebar.Header class="gap-3 border-b border-sidebar-border p-3">
    <div class="px-2 py-1 text-sm font-semibold tracking-tight">MoonTide</div>
    <Button
      type="button"
      class="h-10 w-full justify-start gap-2"
      disabled={newChatDisabled}
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
        {#if model.status === "listing" && model.rows.length === 0}
          <div aria-label="Loading recent Sessions" aria-busy="true">
            <Sidebar.MenuSkeleton showIcon />
            <Sidebar.MenuSkeleton showIcon />
            <Sidebar.MenuSkeleton showIcon />
          </div>
        {:else if model.status === "empty" || (model.status === "ready" && model.rows.length === 0)}
          <p class="px-2 py-3 text-sm text-muted-foreground">No recent conversations.</p>
        {:else}
          {#if model.status === "listing"}
            <p class="px-2 pb-2 text-xs text-muted-foreground" role="status">
              Refreshing recent Sessions…
            </p>
          {/if}
          <div aria-busy={model.status === "listing"}>
          <Sidebar.Menu aria-label="Recent Sessions">
            {#each model.rows as row (row.sessionId)}
              <Sidebar.MenuItem>
                <Sidebar.MenuButton
                  size="lg"
                  isActive={row.selected}
                  aria-disabled={row.selected || rowsDisabled}
                  aria-current={row.selected ? "page" : undefined}
                  aria-label={`${row.excerpt ?? "Untitled session"}${row.selected ? ", Loaded" : ""}`}
                  title={row.sessionId}
                  onclick={() => activateSession(row.sessionId, row.selected || rowsDisabled)}
                >
                  {#if lifecycleTarget === row.sessionId}
                    <LoaderCircleIcon class="animate-spin" />
                  {:else}
                    <MessageSquareIcon />
                  {/if}
                  <span class="flex min-w-0 flex-1 flex-col">
                    <span class="truncate">{row.excerpt ?? "Untitled session"}</span>
                    <span class="truncate text-xs font-normal text-muted-foreground">
                      {row.selected ? "Loaded" : (formatActivity(row.lastActivityAt) ?? "Saved Session")}
                    </span>
                  </span>
                </Sidebar.MenuButton>
              </Sidebar.MenuItem>
            {/each}
          </Sidebar.Menu>
          </div>
        {/if}

        {#if model.status === "failed"}
          <div class="mt-3 rounded-md border border-destructive/40 p-2 text-sm">
            <p class="m-0 text-destructive">{model.error}</p>
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

  {#if connection.kind !== "ready"}
    <Sidebar.Footer class="border-t border-sidebar-border p-3 text-xs text-muted-foreground">
      {connectionLabel(connection)}
    </Sidebar.Footer>
  {/if}
</Sidebar.Root>
