<script lang="ts">
  import { tick } from "svelte";

  import * as Sidebar from "$lib/components/ui/sidebar/index.js";
  import type { DesktopControllerPort, DesktopViewState } from "$lib/controller/index.js";
  import {
    initializeThemePreference,
    setThemePreference,
    type ThemePreference,
  } from "$lib/hooks/theme.js";
  import {
    allowsApproval,
    allowsSessionTransition,
    chatUiModel,
    composerMode,
    runStateKind,
    sessionListModel,
    type CommandPhase,
  } from "$lib/projection/uiModel.js";

  import BlankConversation from "./BlankConversation.svelte";
  import ChatTopBar from "./ChatTopBar.svelte";
  import Composer from "./Composer.svelte";
  import LoadedConversation from "./LoadedConversation.svelte";
  import SessionSidebar from "./SessionSidebar.svelte";

  export let controller: DesktopControllerPort;
  export let view: DesktopViewState;
  export let startupError: string | null = null;

  let prompt = "";
  let phase: CommandPhase = "idle";
  let acceptedSubmissionTurn: number | null = null;
  let actionError: string | null = null;
  let approvalTarget: string | null = null;
  let lifecycleTarget: "new" | string | null = null;
  let sidebarOpen = true;
  let composer: { focus: () => void } | null = null;
  let theme: ThemePreference = initializeThemePreference();

  $: chat = chatUiModel(view.render);
  $: catalog = sessionListModel(view.catalog);
  $: mode = composerMode(view.connection, chat.page, view.render.run, phase);
  $: approvalEnabled = allowsApproval(view.connection, view.render.run, phase);
  $: sessionTransitionEnabled =
    phase === "idle" &&
    lifecycleTarget === null &&
    allowsSessionTransition(view);
  $: visibleError = actionError ?? startupError;
  $: selectedExcerpt =
    catalog.rows.find((row) => row.selected)?.excerpt ??
    (chat.page === "loaded" ? `Session ${chat.sessionId}` : null);
  $: currentRun = runStateKind(view.render.run);
  $: firstSendInFlight =
    view.firstSend.kind === "creating_session" ||
    view.firstSend.kind === "submitting_first_turn";
  $: lastTurn = view.render.session?.summary.last_turn ?? null;
  $: if (
    phase === "submitting" &&
    acceptedSubmissionTurn !== null &&
    !firstSendInFlight &&
    (view.connection.kind !== "ready" ||
      currentRun !== "idle" ||
      (lastTurn !== null && lastTurn >= acceptedSubmissionTurn))
  ) {
    phase = "idle";
    acceptedSubmissionTurn = null;
  }
  $: if (
    phase === "cancelling" &&
    (view.connection.kind !== "ready" ||
      !["thinking", "running_tool", "waiting_approval", "cancelling"].includes(currentRun))
  ) {
    phase = "idle";
  }

  async function submit(): Promise<void> {
    const text = prompt;
    if (text.trim().length === 0 || mode !== "editable") {
      return;
    }
    phase = "submitting";
    acceptedSubmissionTurn = null;
    actionError = null;
    try {
      const response = await controller.submitTurn(text);
      if (response.kind === "turn_accepted" && prompt === text) {
        prompt = "";
      }
      if (response.kind === "turn_accepted") {
        acceptedSubmissionTurn = response.turn;
      } else {
        phase = "idle";
        acceptedSubmissionTurn = null;
      }
    } catch (error) {
      phase = "idle";
      acceptedSubmissionTurn = null;
      recordActionError(error);
    }
  }

  async function cancel(): Promise<void> {
    if (mode !== "active") {
      return;
    }
    phase = "cancelling";
    actionError = null;
    try {
      const response = await controller.cancelTurn();
      if (response.kind !== "cancellation_accepted") {
        phase = "idle";
      }
    } catch (error) {
      phase = "idle";
      recordActionError(error);
    }
  }

  async function resolveApproval(approvalId: string, approve: boolean): Promise<void> {
    if (!approvalEnabled) {
      return;
    }
    phase = "approval";
    approvalTarget = approvalId;
    actionError = null;
    try {
      if (approve) {
        await controller.approve(approvalId);
      } else {
        await controller.deny(approvalId, "denied from desktop ui");
      }
    } catch (error) {
      recordActionError(error);
    } finally {
      phase = "idle";
      approvalTarget = null;
    }
  }

  async function newChat(): Promise<void> {
    if (chat.page === "blank") {
      prompt = "";
      actionError = null;
      await focusComposer();
      return;
    }
    if (!sessionTransitionEnabled) {
      return;
    }
    lifecycleTarget = "new";
    actionError = null;
    try {
      await controller.newChat();
      await focusComposer();
    } catch (error) {
      recordActionError(error);
    } finally {
      lifecycleTarget = null;
    }
  }

  async function loadSession(sessionId: string): Promise<void> {
    if (!sessionTransitionEnabled || chat.sessionId === sessionId) {
      return;
    }
    lifecycleTarget = sessionId;
    actionError = null;
    try {
      await controller.loadSession(sessionId);
    } catch (error) {
      recordActionError(error);
    } finally {
      lifecycleTarget = null;
    }
  }

  async function retryCatalog(): Promise<void> {
    actionError = null;
    try {
      await controller.retryCatalog();
    } catch (error) {
      recordActionError(error);
    }
  }

  async function retryRuntime(): Promise<void> {
    actionError = null;
    try {
      await controller.retryRuntime();
      await focusComposer();
    } catch (error) {
      recordActionError(error);
    }
  }

  function toggleTheme(): void {
    theme = theme === "white" ? "black" : "white";
    setThemePreference(theme);
  }

  function recordActionError(error: unknown): void {
    actionError = error instanceof Error ? error.message : String(error);
  }

  async function focusComposer(): Promise<void> {
    await tick();
    composer?.focus();
  }
</script>

<Sidebar.Provider
  bind:open={sidebarOpen}
  class="h-svh min-h-0 overflow-hidden bg-background"
  style="--sidebar-width: 15rem;"
>
  <SessionSidebar
    model={catalog}
    connection={view.connection}
    newChatDisabled={
      lifecycleTarget !== null ||
      view.firstSend.kind !== "idle" ||
      (chat.page === "loaded" && !sessionTransitionEnabled)
    }
    rowsDisabled={!sessionTransitionEnabled}
    {lifecycleTarget}
    onNewChat={newChat}
    onLoadSession={loadSession}
    onRetryCatalog={retryCatalog}
  />

  <Sidebar.Inset class="h-svh min-h-0 min-w-0 overflow-hidden">
    <ChatTopBar
      title={selectedExcerpt}
      connection={view.connection}
      {theme}
      onToggleTheme={toggleTheme}
    />

    {#if chat.page === "blank"}
      <BlankConversation
        bind:this={composer}
        bind:value={prompt}
        {mode}
        connection={view.connection}
        notices={view.render.notices}
        error={visibleError}
        onSubmit={submit}
        onCancel={cancel}
        onRetryRuntime={retryRuntime}
      />
    {:else}
      <div class="flex min-h-0 flex-1 flex-col">
        <LoadedConversation
          state={view.render}
          connection={view.connection}
          error={visibleError}
          {approvalEnabled}
          {approvalTarget}
          onResolveApproval={resolveApproval}
        />
        <div class="shrink-0 border-t border-border bg-background px-4 py-3">
          <div class="mx-auto w-full max-w-3xl">
            <Composer
              bind:this={composer}
              bind:value={prompt}
              {mode}
              placeholder="Ask a follow-up…"
              showStop
              onSubmit={submit}
              onCancel={cancel}
            />
          </div>
        </div>
      </div>
    {/if}
  </Sidebar.Inset>
</Sidebar.Provider>
