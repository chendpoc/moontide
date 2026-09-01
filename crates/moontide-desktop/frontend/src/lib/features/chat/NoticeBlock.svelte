<script lang="ts">
  import { Alert, AlertDescription, AlertTitle } from "$lib/components/ui/alert/index.js";
  import type { NoticeView } from "$lib/projection/renderState.js";

  export let notice: NoticeView;

  $: title =
    notice.kind === "resync"
      ? "State resync required"
      : notice.kind === "stopped"
        ? "Runtime stopped"
        : "Turn failed";
</script>

<Alert variant={notice.kind === "error" ? "destructive" : "default"} class="py-3">
  <AlertTitle>{title}</AlertTitle>
  <AlertDescription>{notice.message}</AlertDescription>
</Alert>
