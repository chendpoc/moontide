<script lang="ts">
  import { onMount } from "svelte";

  import type { DesktopControllerPort, DesktopViewState } from "$lib/controller/index.js";
  import ChatShell from "$lib/features/chat/ChatShell.svelte";

  export let controller: DesktopControllerPort;

  let view: DesktopViewState = controller.state;
  let startupError: string | null = null;

  onMount(() => {
    const unsubscribe = controller.subscribe((next) => {
      view = next;
    });
    void controller.start().catch((error: unknown) => {
      startupError = error instanceof Error ? error.message : String(error);
    });

    return () => {
      unsubscribe();
      void controller.dispose();
    };
  });
</script>

<ChatShell {controller} {view} {startupError} />
