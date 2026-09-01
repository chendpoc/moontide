<script lang="ts">
  import { tick } from "svelte";

  import * as Sidebar from "$lib/components/ui/sidebar/index.js";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import {
    COMPOSER_STOP_KEY,
    COMPOSER_SUBMIT_MODIFIERS,
    SESSION_SWITCH_LOADING_MIN_MS,
  } from "$lib/constants/index.js";
  import type { DesktopControllerPort, DesktopViewState } from "$lib/controller/index.js";
  import {
    initializeThemePreference,
    setThemePreference,
    type ThemePreference,
  } from "$lib/hooks/theme.js";
  import {
    allowsApproval,
    chatUiModel,
    composerMode,
    connectionAnnouncement,
    historyLoadReason as resolveHistoryLoadReason,
    liveAnnouncementPresentation,
    runStateKind,
    sessionExcerptLabel,
    sessionListModel,
    sessionTransitionReason as resolveSessionTransitionReason,
    visibleConversationNotices,
    type CommandPhase,
    type LifecycleOverlayContext,
  } from "$lib/projection/uiModel.js";

  import BlankConversation from "./BlankConversation.svelte";
  import ChatTopBar from "./ChatTopBar.svelte";
  import Composer from "./Composer.svelte";
  import ComposerAlerts from "./ComposerAlerts.svelte";
  import LoadedConversation from "./LoadedConversation.svelte";
  import SessionDrawerFrame from "./SessionDrawerFrame.svelte";
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
  let historyLoading = false;
  let historyError: string | null = null;
  let historySessionId = view.render.session?.summary.session_id ?? null;
  let sidebarOpen = true;
  let composer: { focus: () => void; containsFocus: () => boolean } | null = null;
  let topBar: { focusTitle: () => void } | null = null;
  let theme: ThemePreference = initializeThemePreference();
  let uiStatusAnnouncement = "";
  let previousConnectionKind = view.connection.kind;
  let liveEventAnnouncement = "";
  let previousLiveAnnouncementId = view.render.liveAnnouncement?.id ?? null;

  $: chat = chatUiModel(view.render);
  $: catalog = sessionListModel(view.catalog);
  $: mode = composerMode(view.connection, chat.page, view.render.run, phase);
  $: approvalEnabled = allowsApproval(
    view.connection,
    view.render.run,
    phase,
    Object.keys(view.render.approvals).length,
  );
  $: lifecycleOverlay = {
    historyLoading,
    lifecycleTarget,
    phase,
  } satisfies LifecycleOverlayContext;
  $: sessionTransitionReason = resolveSessionTransitionReason(view, lifecycleOverlay);
  $: sessionTransitionEnabled = sessionTransitionReason === null;
  $: historyBlockReason = resolveHistoryLoadReason(view, lifecycleOverlay);
  $: historyEnabled = historyBlockReason === null;
  $: visibleError = actionError ?? startupError;
  $: selectedExcerpt =
    chat.page === "loaded"
      ? sessionExcerptLabel(catalog.rows.find((row) => row.selected)?.excerpt ?? null)
      : null;
  $: currentRun = runStateKind(view.render.run);
  $: firstSendInFlight =
    view.firstSend.kind === "creating_session" ||
    view.firstSend.kind === "submitting_first_turn";
  $: sessionSwitching = lifecycleTarget !== null && lifecycleTarget !== "new";
  $: lastTurn = view.render.session?.summary.last_turn ?? null;
  $: currentHistorySessionId = view.render.session?.summary.session_id ?? null;
  $: if (currentHistorySessionId !== historySessionId) {
    historySessionId = currentHistorySessionId;
    historyError = null;
  }
  $: if (
    phase === "submitting" &&
    (currentRun === "waiting_approval" ||
      (acceptedSubmissionTurn !== null &&
        !firstSendInFlight &&
        (view.connection.kind !== "ready" ||
          currentRun !== "idle" ||
          (lastTurn !== null && lastTurn >= acceptedSubmissionTurn))))
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
  $: if (view.connection.kind !== previousConnectionKind) {
    previousConnectionKind = view.connection.kind;
    uiStatusAnnouncement = connectionAnnouncement(view.connection.kind);
  }
  $: if ((view.render.liveAnnouncement?.id ?? null) !== previousLiveAnnouncementId) {
    previousLiveAnnouncementId = view.render.liveAnnouncement?.id ?? null;
    liveEventAnnouncement =
      view.render.liveAnnouncement === null
        ? ""
        : liveAnnouncementPresentation(view.render.liveAnnouncement);
  }

  async function submit(): Promise<void> {
    const text = prompt;
    if (text.trim().length === 0 || mode !== "editable") {
      return;
    }
    const restoreComposerFocus = composer?.containsFocus() ?? false;
    let focusMoved = false;
    const recordFocusMove = (): void => {
      focusMoved = true;
    };
    if (restoreComposerFocus) {
      window.addEventListener("focusin", recordFocusMove);
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
        if (restoreComposerFocus && !focusMoved) {
          await focusComposer();
        }
      } else {
        phase = "idle";
        acceptedSubmissionTurn = null;
      }
    } catch (error) {
      phase = "idle";
      acceptedSubmissionTurn = null;
      recordActionError(error);
    } finally {
      window.removeEventListener("focusin", recordFocusMove);
    }
  }

  async function cancel(): Promise<void> {
    if (mode !== "active" || phase !== "idle") {
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
    const startedAt = performance.now();
    try {
      await controller.newChat();
      await holdSessionSwitch(startedAt);
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
    const startedAt = performance.now();
    try {
      await controller.loadSession(sessionId);
      await holdSessionSwitch(startedAt);
      await focusLoadedConversation();
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

  async function loadOlderHistory(): Promise<void> {
    if (historyLoading || !historyEnabled) {
      return;
    }
    historyLoading = true;
    historyError = null;
    try {
      await controller.loadOlderHistory();
    } catch (error) {
      historyError = error instanceof Error ? error.message : String(error);
    } finally {
      historyLoading = false;
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
    uiStatusAnnouncement = `${theme === "white" ? "White" : "Black"} theme enabled`;
  }

  function handleGlobalKeydown(event: KeyboardEvent): void {
    if (event.isComposing || event.repeat || mode !== "active" || phase !== "idle") {
      return;
    }
    if (
      event.key === COMPOSER_STOP_KEY &&
      COMPOSER_SUBMIT_MODIFIERS.some((modifier) => event[modifier])
    ) {
      event.preventDefault();
      void cancel();
    }
  }

  function toggleSidebar(): void {
    sidebarOpen = !sidebarOpen;
  }

  async function holdSessionSwitch(startedAt: number): Promise<void> {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const remaining = SESSION_SWITCH_LOADING_MIN_MS - (performance.now() - startedAt);
    if (remaining > 0) {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, remaining);
      });
    }
  }

  function recordActionError(error: unknown): void {
    actionError = error instanceof Error ? error.message : String(error);
  }

  async function focusComposer(): Promise<void> {
    await tick();
    composer?.focus();
  }

  async function focusLoadedConversation(): Promise<void> {
    await tick();
    topBar?.focusTitle();
  }
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<Sidebar.Provider
  bind:open={sidebarOpen}
  class="h-svh min-h-0 overflow-hidden bg-background"
  style="--sidebar-width: 15rem;"
>
  <SessionDrawerFrame bind:open={sidebarOpen}>
    <SessionSidebar
      model={catalog}
      newChatDisabled={
        lifecycleTarget !== null ||
        view.firstSend.kind !== "idle" ||
        (chat.page === "loaded" && !sessionTransitionEnabled)
      }
      rowsBlockedReason={sessionTransitionReason}
      {lifecycleTarget}
      onNewChat={newChat}
      onLoadSession={loadSession}
      onRetryCatalog={retryCatalog}
    />
  </SessionDrawerFrame>

  <main class="flex h-svh min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
    <ChatTopBar
      bind:this={topBar}
      title={selectedExcerpt}
      loaded={chat.page === "loaded"}
      {theme}
      drawerOpen={sidebarOpen}
      onToggleDrawer={toggleSidebar}
      onToggleTheme={toggleTheme}
    />

    {#if sessionSwitching}
      <div
        class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-muted-foreground"
        role="status"
        aria-label="Loading conversation"
      >
        <LoaderCircleIcon class="size-6 animate-spin motion-reduce:animate-none" />
        <p class="m-0 text-sm">Loading…</p>
      </div>
    {:else if chat.page === "blank"}
      <BlankConversation
        bind:this={composer}
        bind:value={prompt}
        {mode}
        connection={view.connection}
        notices={visibleConversationNotices(view.render, view.connection)}
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
          {approvalEnabled}
          {approvalTarget}
          {historyLoading}
          {historyError}
          {historyEnabled}
          {historyBlockReason}
          onResolveApproval={resolveApproval}
          onLoadOlderHistory={loadOlderHistory}
        />
        <div class="shrink-0 border-t border-border bg-background py-3">
          <div class="mx-auto w-full max-w-3xl px-4">
            <ComposerAlerts
              connection={view.connection}
              actionError={visibleError}
              onRetryRuntime={retryRuntime}
              alertClass="mb-3 py-3"
            />
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
  </main>

  <p
    class="sr-only"
    aria-live="polite"
    aria-atomic="true"
    data-testid="ui-status-announcement"
  >{uiStatusAnnouncement}</p>
  <p
    class="sr-only"
    aria-live="polite"
    aria-atomic="true"
    data-testid="live-event-announcement"
  >{liveEventAnnouncement}</p>
</Sidebar.Provider>
