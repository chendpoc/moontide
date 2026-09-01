<script lang="ts">
  import { Alert, AlertDescription, AlertTitle } from "$lib/components/ui/alert/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import type { ConnectionState } from "$lib/controller/index.js";
  import type { RenderState } from "$lib/projection/renderState.js";
  import type { ComposerMode } from "$lib/projection/uiModel.js";

  import Composer from "./Composer.svelte";

  export let value = "";
  export let mode: ComposerMode;
  export let connection: ConnectionState;
  export let notices: RenderState["notices"];
  export let error: string | null;
  export let onSubmit: () => void | Promise<void>;
  export let onCancel: () => void | Promise<void>;
  export let onRetryRuntime: () => void | Promise<void>;

  let composer: { focus: () => void } | null = null;

  export function focus(): void {
    composer?.focus();
  }
</script>

<section class="flex min-h-0 flex-1 overflow-y-auto px-4 py-8" aria-labelledby="blank-heading">
  <div class="m-auto flex w-full max-w-2xl flex-col gap-6 pb-[8vh]">
    <h1 id="blank-heading" class="m-0 text-center text-3xl font-semibold tracking-tight">
      How can I help?
    </h1>

    {#if connection.kind === "degraded" || connection.kind === "disconnected"}
      <Alert variant="destructive">
        <AlertTitle>Runtime unavailable</AlertTitle>
        <AlertDescription>{connection.message}</AlertDescription>
        <div class="mt-3">
          <Button type="button" size="sm" variant="outline" onclick={() => void onRetryRuntime()}>
            Retry
          </Button>
        </div>
      </Alert>
    {/if}

    {#if error !== null}
      <Alert variant="destructive">
        <AlertTitle>Action failed</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    {/if}

    {#each notices as notice}
      <Alert variant={notice.kind === "error" ? "destructive" : "default"}>
        <AlertDescription>{notice.message}</AlertDescription>
      </Alert>
    {/each}

    <Composer
      bind:this={composer}
      bind:value
      {mode}
      placeholder="Ask anything…"
      {onSubmit}
      {onCancel}
    />
  </div>
</section>
