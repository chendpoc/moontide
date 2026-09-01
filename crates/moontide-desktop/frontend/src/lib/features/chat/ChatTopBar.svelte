<script lang="ts">
  import MoonIcon from "@lucide/svelte/icons/moon";
  import PanelLeftIcon from "@lucide/svelte/icons/panel-left";
  import SunIcon from "@lucide/svelte/icons/sun";

  import { Button } from "$lib/components/ui/button/index.js";
  import type { ThemePreference } from "$lib/hooks/theme.js";
  import { UNTITLED_SESSION_LABEL } from "$lib/projection/uiModel.js";

  export let title: string | null;
  export let loaded: boolean;
  export let theme: ThemePreference;
  export let drawerOpen: boolean;
  export let onToggleDrawer: () => void;
  export let onToggleTheme: () => void;

  let titleElement: HTMLHeadingElement | null = null;

  export function focusTitle(): void {
    titleElement?.focus();
  }
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
  {#if loaded}
    <h1
      bind:this={titleElement}
      tabindex="-1"
      class="min-w-0 flex-1 truncate rounded-sm text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {title ?? UNTITLED_SESSION_LABEL}
    </h1>
  {:else}
    <div class="min-w-0 flex-1 truncate text-sm font-medium">New conversation</div>
  {/if}
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
