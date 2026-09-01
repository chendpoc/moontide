<script lang="ts">
  import type { ConnectionState } from "$lib/controller/index.js";
  import type { RenderState } from "$lib/projection/renderState.js";
  import type { ComposerMode } from "$lib/projection/uiModel.js";

  import Composer from "./Composer.svelte";
  import ComposerAlerts from "./ComposerAlerts.svelte";
  import NoticeBlock from "./NoticeBlock.svelte";

  export let value = "";
  export let mode: ComposerMode;
  export let connection: ConnectionState;
  export let notices: RenderState["notices"];
  export let error: string | null;
  export let onSubmit: () => void | Promise<void>;
  export let onCancel: () => void | Promise<void>;
  export let onRetryRuntime: () => void | Promise<void>;

  let composer: { focus: () => void; containsFocus: () => boolean } | null = null;

  export function focus(): void {
    composer?.focus();
  }

  export function containsFocus(): boolean {
    return composer?.containsFocus() ?? false;
  }
</script>

<section class="flex min-h-0 flex-1 overflow-y-auto px-4 py-8" aria-labelledby="blank-heading">
  <div class="m-auto flex w-full max-w-2xl flex-col gap-6 pb-[8vh]">
    <h1 id="blank-heading" class="m-0 text-center text-3xl font-semibold tracking-tight">
      How can I help?
    </h1>

    <ComposerAlerts {connection} actionError={error} {onRetryRuntime} />

    {#each notices as notice}
      <NoticeBlock {notice} />
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
