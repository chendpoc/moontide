<script lang="ts">
  import CopyMessageButton from "./CopyMessageButton.svelte";

  export let text: string;
</script>

<article class="group flex justify-end" data-message-kind="user">
  <div class="relative max-w-[80%] rounded-xl bg-message-user px-4 py-3 pr-11 leading-6">
    <p class="m-0 whitespace-pre-wrap break-words">{text}</p>
    <div class="absolute right-1.5 top-1.5">
      <CopyMessageButton {text} label="Copy user message" />
    </div>
  </div>
</article>
