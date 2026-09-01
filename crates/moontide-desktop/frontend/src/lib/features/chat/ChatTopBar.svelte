<script lang="ts">
  import MoonIcon from "@lucide/svelte/icons/moon";
  import SunIcon from "@lucide/svelte/icons/sun";

  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Sidebar from "$lib/components/ui/sidebar/index.js";
  import type { ConnectionState } from "$lib/controller/index.js";
  import type { ThemePreference } from "$lib/hooks/theme.js";
  import { connectionLabel } from "$lib/projection/uiModel.js";

  export let title: string | null;
  export let connection: ConnectionState;
  export let theme: ThemePreference;
  export let onToggleTheme: () => void;

  $: connectionIsAlert =
    connection.kind === "degraded" || connection.kind === "disconnected";
</script>

<header class="flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-3 md:px-4">
  <Sidebar.Trigger class="min-[1100px]:hidden" aria-label="Open Session sidebar" />
  <div class="min-w-0 flex-1 truncate text-sm font-medium">
    {title ?? "New conversation"}
  </div>
  <Badge variant={connectionIsAlert ? "destructive" : "outline"}>
    {connectionLabel(connection)}
  </Badge>
  <Button
    type="button"
    variant="ghost"
    size="icon"
    aria-label={theme === "white" ? "Switch to Black theme" : "Switch to White theme"}
    title={theme === "white" ? "Black theme" : "White theme"}
    onclick={onToggleTheme}
  >
    {#if theme === "white"}
      <MoonIcon />
    {:else}
      <SunIcon />
    {/if}
  </Button>
</header>
