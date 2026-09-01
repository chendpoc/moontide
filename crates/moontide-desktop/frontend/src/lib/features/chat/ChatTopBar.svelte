<script lang="ts">
  import MoonIcon from "@lucide/svelte/icons/moon";
  import PanelLeftIcon from "@lucide/svelte/icons/panel-left";
  import SunIcon from "@lucide/svelte/icons/sun";

  import { Button } from "$lib/components/ui/button/index.js";
  import type { ThemePreference } from "$lib/hooks/theme.js";

  export let title: string | null;
  export let theme: ThemePreference;
  export let drawerOpen: boolean;
  export let onToggleDrawer: () => void;
  export let onToggleTheme: () => void;
</script>

<header class="flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-3 md:px-4">
  <Button
    type="button"
    variant="ghost"
    size="icon"
    aria-label={drawerOpen ? "Close Session drawer" : "Open Session drawer"}
    aria-pressed={drawerOpen}
    title={drawerOpen ? "Close Session drawer" : "Open Session drawer"}
    onclick={onToggleDrawer}
  >
    <PanelLeftIcon />
  </Button>
  <div class="min-w-0 flex-1 truncate text-sm font-medium">
    {title ?? "New conversation"}
  </div>
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
