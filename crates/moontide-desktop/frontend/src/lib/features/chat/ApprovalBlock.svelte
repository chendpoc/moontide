<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import type { ApprovalView } from "$lib/projection/renderState.js";

  export let approval: ApprovalView;
  export let enabled: boolean;
  export let resolving: boolean;
  export let onResolve: (approvalId: string, approve: boolean) => void | Promise<void>;
</script>

<section class="rounded-lg border border-warning/50 bg-message-tool p-3 text-sm" data-approval-id={approval.request.id}>
  <div class="flex flex-wrap items-start justify-between gap-2">
    <div>
      <p class="m-0 font-medium text-warning">Approval required</p>
      <p class="mb-0 mt-1">{approval.request.call.name}</p>
      <p class="mb-0 mt-1 text-xs text-muted-foreground">{approval.request.working_dir}</p>
    </div>
    {#if resolving}
      <p class="m-0 text-xs text-muted-foreground" role="status">Resolving approval…</p>
    {/if}
  </div>
  <div class="mt-3 flex gap-2">
    <Button
      type="button"
      size="sm"
      disabled={!enabled || resolving}
      onclick={() => void onResolve(approval.request.id, true)}
    >
      Allow
    </Button>
    <Button
      type="button"
      size="sm"
      variant="destructive"
      disabled={!enabled || resolving}
      onclick={() => void onResolve(approval.request.id, false)}
    >
      Deny
    </Button>
  </div>
</section>
