<script lang="ts">
  import { onMount } from "svelte";

  import type { DesktopControllerPort, DesktopViewState } from "./controller";
  import type { DesktopResponse } from "./protocol";
  import {
    allowsApproval,
    blocksText,
    composerMode,
    connectionLabel,
    liveTools,
    orderedDrafts,
    runStateKind,
    runStateLabel,
    snapshotText,
    toolStatusLabel,
    type CommandPhase,
  } from "./uiModel";

  export let controller: DesktopControllerPort;

  let view: DesktopViewState = controller.state;
  let prompt = "";
  let phase: CommandPhase = "idle";
  let actionError: string | null = null;

  $: mode = composerMode(view.connection, view.render.run, phase);
  $: approvalEnabled = allowsApproval(view.connection, view.render.run, phase);
  $: drafts = orderedDrafts(view.render);
  $: tools = liveTools(view.render);
  $: approvals = Object.values(view.render.approvals);

  onMount(() => {
    const unsubscribe = controller.subscribe((next) => {
      view = next;
      settlePhase();
    });
    window.addEventListener("keydown", handleGlobalKeydown);
    void controller.start().catch(recordActionError);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeydown);
      unsubscribe();
      void controller.dispose();
    };
  });

  async function submit(): Promise<void> {
    const text = prompt.trim();
    if (text.length === 0 || mode !== "editable") {
      return;
    }
    phase = "submitting";
    actionError = null;
    try {
      const response = await controller.send({ kind: "submit_turn", text });
      if (response.kind === "turn_accepted") {
        prompt = "";
      } else {
        phase = "idle";
      }
      settlePhase(response);
    } catch (error) {
      phase = "idle";
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
      const response = await controller.send({ kind: "cancel_turn" });
      if (response.kind !== "cancellation_accepted") {
        phase = "idle";
      }
      settlePhase(response);
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
    actionError = null;
    try {
      const response = await controller.send(
        approve
          ? { kind: "approve", approval_id: approvalId }
          : {
              kind: "deny",
              approval_id: approvalId,
              reason: "denied from desktop ui",
            },
      );
      if (response.kind !== "approval_accepted") {
        phase = "idle";
      }
    } catch (error) {
      recordActionError(error);
    } finally {
      phase = "idle";
    }
  }

  function handleGlobalKeydown(event: KeyboardEvent): void {
    if (event.repeat) {
      return;
    }
    if (
      event.target instanceof HTMLTextAreaElement &&
      event.key === "Enter" &&
      (event.metaKey || event.ctrlKey)
    ) {
      event.preventDefault();
      void submit();
      return;
    }
    if (event.key === "Escape" && mode === "active") {
      event.preventDefault();
      void cancel();
    }
  }

  function settlePhase(response?: DesktopResponse): void {
    const run = runStateKind(view.render.run);
    if (
      phase === "submitting" &&
      (run !== "idle" || response?.kind === "rejected")
    ) {
      phase = "idle";
    }
    if (
      phase === "cancelling" &&
      !["thinking", "running_tool", "waiting_approval", "cancelling"].includes(run)
    ) {
      phase = "idle";
    }
  }

  function recordActionError(error: unknown): void {
    actionError = error instanceof Error ? error.message : String(error);
  }
</script>

<header class="topbar">
  <div class="brand">MoonTide</div>
  <div class="run-state">{runStateLabel(view.render.run)}</div>
  <div class:connection-alert={view.connection.kind !== "ready"} class="connection-state">
    {connectionLabel(view.connection)}
  </div>
  {#if view.render.session !== null}
    <div class="session-id">session {view.render.session.summary.session_id}</div>
  {/if}
</header>

<main class="layout">
  <section class="conversation" aria-label="Conversation" aria-live="polite">
    {#if view.render.messages.length === 0 && drafts.length === 0 && tools.length === 0}
      <p class="empty-state">Start a conversation with MoonTide.</p>
    {/if}

    {#each view.render.messages as message}
      {#if message.kind === "user"}
        <article class="message user">
          <span class="message-role">You</span>
          <p>{message.text}</p>
        </article>
      {:else if message.kind === "assistant"}
        <article class="message assistant">
          <span class="message-role">MoonTide</span>
          <p>{blocksText(message.blocks)}</p>
        </article>
      {:else if message.kind === "tool_call"}
        <article class="message tool">
          <span class="message-role">Tool</span>
          <p>{message.call.name} · running</p>
        </article>
      {:else}
        <article class="message tool">
          <span class="message-role">Tool</span>
          <p>{message.result.name} · {toolStatusLabel(message.result)}</p>
        </article>
      {/if}
    {/each}

    {#each drafts as draft}
      <article class="message assistant draft">
        <span class="message-role">MoonTide · streaming</span>
        <p>{snapshotText(draft.snapshot)}</p>
      </article>
    {/each}

    {#each tools as tool}
      <article class="message tool">
        <span class="message-role">Tool</span>
        <p>{tool.call.name} · {toolStatusLabel(tool.result)}</p>
      </article>
    {/each}

    {#each approvals as approval}
      <article class="message approval-card">
        <span class="message-role">Approval required</span>
        <p>{approval.request.call.name}</p>
        <div class="approval-actions">
          <button
            type="button"
            disabled={!approvalEnabled}
            onclick={() => void resolveApproval(approval.request.id, true)}>Allow</button
          >
          <button
            class="danger"
            type="button"
            disabled={!approvalEnabled}
            onclick={() => void resolveApproval(approval.request.id, false)}>Deny</button
          >
        </div>
      </article>
    {/each}
  </section>

  <aside class="notices" aria-label="Status and notices" aria-live="polite">
    {#if view.connection.kind === "degraded" || view.connection.kind === "disconnected"}
      <div class="notice error">{view.connection.message}</div>
    {/if}
    {#if actionError !== null}
      <div class="notice error">{actionError}</div>
    {/if}
    {#each view.render.notices as notice}
      <div class:error={notice.kind === "error"} class="notice">
        {notice.message}
      </div>
    {/each}
    {#if
      view.render.delivery.droppedSnapshots > 0 ||
      view.render.delivery.bufferedEvents > 0
    }
      <div class="notice">
        Delivery · {view.render.delivery.droppedSnapshots} dropped snapshots ·
        {view.render.delivery.bufferedEvents} buffered events
      </div>
    {/if}
  </aside>
</main>

<footer class="composer">
  <label for="prompt">Message</label>
  <textarea
    id="prompt"
    rows="4"
    placeholder="Ask MoonTide… (Cmd/Ctrl+Enter to send, Esc to stop)"
    bind:value={prompt}
    disabled={mode !== "editable"}
  ></textarea>
  <div class="composer-actions">
    <button type="button" disabled={mode !== "active"} onclick={() => void cancel()}>
      {mode === "cancelling" ? "Cancelling" : "Stop"}
    </button>
    <button
      class="primary"
      type="button"
      disabled={mode !== "editable" || prompt.trim().length === 0}
      onclick={() => void submit()}
    >
      {mode === "submitting" ? "Sending" : "Send"}
    </button>
  </div>
</footer>
