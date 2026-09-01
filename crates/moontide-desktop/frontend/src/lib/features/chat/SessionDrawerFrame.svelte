<script lang="ts">
  const DEFAULT_WIDTH = 240;
  const MIN_WIDTH = 200;
  const MAX_WIDTH = 360;
  const KEYBOARD_STEP = 16;

  export let open: boolean;

  let width = DEFAULT_WIDTH;
  let widthTransition = false;
  let resizing = false;
  let previousOpen = open;

  $: if (open !== previousOpen) {
    previousOpen = open;
    widthTransition = true;
  }

  function toggleTransitionEnd(event: TransitionEvent): void {
    if (event.target === event.currentTarget && event.propertyName === "width") {
      widthTransition = false;
    }
  }

  function clampWidth(candidate: number): number {
    return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, candidate));
  }

  function startResize(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    widthTransition = false;
    resizing = true;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function resize(event: PointerEvent): void {
    if (resizing) {
      width = clampWidth(event.clientX);
    }
  }

  function stopResize(): void {
    resizing = false;
  }

  function resizeFromKeyboard(event: KeyboardEvent): void {
    let nextWidth: number | null = null;
    if (event.key === "ArrowLeft") {
      nextWidth = width - KEYBOARD_STEP;
    } else if (event.key === "ArrowRight") {
      nextWidth = width + KEYBOARD_STEP;
    } else if (event.key === "Home") {
      nextWidth = MIN_WIDTH;
    } else if (event.key === "End") {
      nextWidth = MAX_WIDTH;
    }
    if (nextWidth === null) {
      return;
    }
    event.preventDefault();
    widthTransition = false;
    width = clampWidth(nextWidth);
  }
</script>

<svelte:window
  onpointermove={resize}
  onpointerup={stopResize}
  onpointercancel={stopResize}
  onblur={stopResize}
/>

<div
  class:select-none={resizing}
  class:transition-[width]={widthTransition && !resizing}
  class:duration-200={widthTransition && !resizing}
  class:ease-out={widthTransition && !resizing}
  class="relative h-svh min-h-0 shrink-0 overflow-hidden motion-reduce:transition-none"
  style={`width: ${open ? width : 0}px;`}
  data-testid="session-drawer-layout"
  data-state={open ? "open" : "closed"}
  aria-hidden={!open}
  inert={!open || undefined}
  ontransitionend={toggleTransitionEnd}
>
  <div class="h-full min-h-0" style={`width: ${width}px;`}>
    <slot />
  </div>
  {#if open}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex a11y_no_noninteractive_element_interactions -->
    <div
      role="separator"
      aria-label="Resize Session drawer"
      aria-orientation="vertical"
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      aria-valuenow={width}
      tabindex="0"
      class="group absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none outline-none"
      onpointerdown={startResize}
      onkeydown={resizeFromKeyboard}
    >
      <span
        class="absolute inset-y-0 left-1/2 w-px bg-transparent transition-colors group-hover:bg-ring group-focus-visible:bg-ring"
      ></span>
    </div>
  {/if}
</div>
