<script lang="ts">
  import { tick } from "svelte";

  import { Alert, AlertDescription, AlertTitle } from "$lib/components/ui/alert/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
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

  const DRAWER_DEFAULT_WIDTH = 240;
  const DRAWER_MIN_WIDTH = 200;
  const DRAWER_MAX_WIDTH = 360;
  const DRAWER_KEYBOARD_STEP = 16;

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
  let sidebarWidth = DRAWER_DEFAULT_WIDTH;
  let sidebarWidthTransition = false;
  let resizingSidebar = false;
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

  function toggleSidebar(): void {
    sidebarOpen = !sidebarOpen;
    sidebarWidthTransition = true;
  }

  function endSidebarWidthTransition(event: TransitionEvent): void {
    if (event.target !== event.currentTarget || event.propertyName !== "width") {
      return;
    }
    sidebarWidthTransition = false;
  }

  function clampSidebarWidth(width: number): number {
    return Math.min(DRAWER_MAX_WIDTH, Math.max(DRAWER_MIN_WIDTH, width));
  }

  function startSidebarResize(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    sidebarWidthTransition = false;
    resizingSidebar = true;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function resizeSidebar(event: PointerEvent): void {
    if (!resizingSidebar) {
      return;
    }
    sidebarWidth = clampSidebarWidth(event.clientX);
  }

  function stopSidebarResize(): void {
    resizingSidebar = false;
  }

  function resizeSidebarFromKeyboard(event: KeyboardEvent): void {
    let nextWidth: number | null = null;
    if (event.key === "ArrowLeft") {
      nextWidth = sidebarWidth - DRAWER_KEYBOARD_STEP;
    } else if (event.key === "ArrowRight") {
      nextWidth = sidebarWidth + DRAWER_KEYBOARD_STEP;
    } else if (event.key === "Home") {
      nextWidth = DRAWER_MIN_WIDTH;
    } else if (event.key === "End") {
      nextWidth = DRAWER_MAX_WIDTH;
    }
    if (nextWidth === null) {
      return;
    }
    event.preventDefault();
    sidebarWidthTransition = false;
    sidebarWidth = clampSidebarWidth(nextWidth);
  }

  function recordActionError(error: unknown): void {
    actionError = error instanceof Error ? error.message : String(error);
  }

  async function focusComposer(): Promise<void> {
    await tick();
    composer?.focus();
  }
</script>

<svelte:window
  onpointermove={resizeSidebar}
  onpointerup={stopSidebarResize}
  onpointercancel={stopSidebarResize}
  onblur={stopSidebarResize}
/>

<Sidebar.Provider
  bind:open={sidebarOpen}
  class="h-svh min-h-0 overflow-hidden bg-background"
  style="--sidebar-width: 15rem;"
>
  <div
    class:select-none={resizingSidebar}
    class:transition-[width]={sidebarWidthTransition && !resizingSidebar}
    class:duration-200={sidebarWidthTransition && !resizingSidebar}
    class:ease-out={sidebarWidthTransition && !resizingSidebar}
    class="relative h-svh min-h-0 shrink-0 overflow-hidden motion-reduce:transition-none"
    style={`width: ${sidebarOpen ? sidebarWidth : 0}px;`}
    data-testid="session-drawer-layout"
    data-state={sidebarOpen ? "open" : "closed"}
    aria-hidden={!sidebarOpen}
    inert={!sidebarOpen || undefined}
    ontransitionend={endSidebarWidthTransition}
  >
    <div class="h-full min-h-0" style={`width: ${sidebarWidth}px;`}>
      <SessionSidebar
        model={catalog}
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
    </div>
    {#if sidebarOpen}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex a11y_no_noninteractive_element_interactions -->
      <div
        role="separator"
        aria-label="Resize Session drawer"
        aria-orientation="vertical"
        aria-valuemin={DRAWER_MIN_WIDTH}
        aria-valuemax={DRAWER_MAX_WIDTH}
        aria-valuenow={sidebarWidth}
        tabindex="0"
        class="group absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none outline-none"
        onpointerdown={startSidebarResize}
        onkeydown={resizeSidebarFromKeyboard}
      >
        <span
          class="absolute inset-y-0 left-1/2 w-px bg-transparent transition-colors group-hover:bg-ring group-focus-visible:bg-ring"
        ></span>
      </div>
    {/if}
  </div>

  <main class="flex h-svh min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
    <ChatTopBar
      title={selectedExcerpt}
      {theme}
      drawerOpen={sidebarOpen}
      onToggleDrawer={toggleSidebar}
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
          {approvalEnabled}
          {approvalTarget}
          onResolveApproval={resolveApproval}
        />
        <div class="shrink-0 border-t border-border bg-background py-3">
          <div class="mx-auto w-full max-w-3xl px-4">
            {#if view.connection.kind === "starting"}
              <Alert class="mb-3 py-3">
                <AlertTitle>Starting MoonTide</AlertTitle>
                <AlertDescription>Sending will be available shortly.</AlertDescription>
              </Alert>
            {:else if view.connection.kind === "degraded" || view.connection.kind === "disconnected"}
              <Alert variant="destructive" class="mb-3 py-3">
                <AlertTitle>Connection unavailable</AlertTitle>
                <AlertDescription>{view.connection.message}</AlertDescription>
                <div class="mt-3">
                  <Button type="button" size="sm" variant="outline" onclick={() => void retryRuntime()}>
                    Retry
                  </Button>
                </div>
              </Alert>
            {/if}
            {#if visibleError !== null}
              <Alert variant="destructive" class="mb-3 py-3">
                <AlertTitle>Action failed</AlertTitle>
                <AlertDescription>{visibleError}</AlertDescription>
              </Alert>
            {/if}
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
</Sidebar.Provider>
