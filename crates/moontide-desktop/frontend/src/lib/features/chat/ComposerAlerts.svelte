<script lang="ts">
  import { Alert, AlertDescription, AlertTitle } from "$lib/components/ui/alert/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import type { ConnectionState } from "$lib/controller/index.js";
  import {
    actionErrorCopy,
    composerAlertPresentation,
    connectionPresentation,
  } from "$lib/projection/uiModel.js";

  export let connection: ConnectionState;
  export let actionError: string | null;
  export let onRetryRuntime: () => void | Promise<void>;
  export let alertClass = "";

  $: connectionAlert = connectionPresentation(connection);
  $: startingAlert = composerAlertPresentation("starting");
  $: actionFailedAlert = composerAlertPresentation("action_failed");
</script>

{#if connection.kind === "starting"}
  <Alert role="group" class={alertClass}>
    <AlertTitle>{startingAlert.title}</AlertTitle>
    <AlertDescription>{startingAlert.description}</AlertDescription>
  </Alert>
{:else if connectionAlert !== null}
  <Alert role="group" variant="destructive" class={alertClass}>
    <AlertTitle>{connectionAlert.title}</AlertTitle>
    <AlertDescription>{connectionAlert.description}</AlertDescription>
    <div class="mt-3">
      <Button type="button" size="sm" variant="outline" onclick={() => void onRetryRuntime()}>
        Retry
      </Button>
    </div>
  </Alert>
{/if}

{#if actionError !== null}
  <Alert variant="destructive" class={alertClass}>
    <AlertTitle>{actionFailedAlert.title}</AlertTitle>
    <AlertDescription>{actionErrorCopy(actionError)}</AlertDescription>
  </Alert>
{/if}
