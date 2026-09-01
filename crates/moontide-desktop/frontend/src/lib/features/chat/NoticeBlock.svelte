<script lang="ts">
  import { Alert, AlertDescription, AlertTitle } from "$lib/components/ui/alert/index.js";
  import type { NoticeView } from "$lib/projection/renderState.js";
  import { noticePresentation } from "$lib/projection/uiModel.js";

  export let notice: NoticeView;

  $: copy = noticePresentation(notice);
</script>

<Alert role="group" variant={notice.kind === "error" ? "destructive" : "default"} class="py-3">
  <AlertTitle>{copy.title}</AlertTitle>
  <AlertDescription>{copy.description}</AlertDescription>
</Alert>
