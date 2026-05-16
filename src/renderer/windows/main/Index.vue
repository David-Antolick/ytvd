<script setup lang="ts">
import { onMounted, ref } from "vue";
import TitleBar from "../../components/TitleBar.vue";
import YTMViewLoading from "../../components/YTMViewLoading.vue";
import logo from "~assets/icons/ytmd_white.png";

const keyboardFocus = ref<HTMLElement>(null);
const keyboardFocusZero = ref<HTMLElement>(null);
const activeView = ref<"music" | "video">("music");

async function refreshActiveView() {
  activeView.value = (await window.ytmd.getActiveView()) ?? "music";
}

function toggleView() {
  window.ytmd.toggleActiveView();
  // Flip optimistically; main process is the source of truth so re-sync on next focus.
  activeView.value = activeView.value === "music" ? "video" : "music";
}

onMounted(() => {
  window.onfocus = () => {
    if (document.activeElement != keyboardFocusZero.value) {
      // This resets the focus of keyboard navigation
      keyboardFocusZero.value.focus();
      keyboardFocusZero.value.blur();
    }
    refreshActiveView();
  };

  keyboardFocus.value.onfocus = () => {
    window.ytmd.switchFocus("ytm");
  };

  window.ytmd.requestWindowState();
  refreshActiveView();
});
</script>

<template>
  <div ref="keyboardFocusZero" tabindex="0"></div>
  <Suspense>
    <TitleBar is-main-window has-home-button has-settings-button has-minimize-button has-maximize-button title="YTVD" :icon-file="logo">
      <template #app-buttons>
        <button class="app-button" tabindex="1" :title="activeView === 'music' ? 'Switch to YouTube' : 'Switch to Music'" @click="toggleView">
          <span class="material-symbols-outlined">{{ activeView === "music" ? "smart_display" : "music_note" }}</span>
        </button>
      </template>
    </TitleBar>
  </Suspense>
  <Suspense>
    <YTMViewLoading />
  </Suspense>
  <div ref="keyboardFocus" tabindex="32767"></div>
</template>

<style scoped>
/* Mirrors .app-button in TitleBar.vue. Slotted buttons can't inherit the parent component's
   scoped styles, so the no-drag region + sizing has to be redeclared here. */
.app-button {
  margin-right: 4px;
  height: 28px;
  width: 28px;
  background: none;
  color: #bbbbbb;
  display: flex;
  align-items: center;
  justify-content: center;
  -webkit-app-region: no-drag;
  border: none;
  border-radius: 4px;
  font-variation-settings:
    "FILL" 0,
    "wght" 200,
    "GRAD" 0,
    "opsz" 28;
  cursor: pointer;
}
.app-button:hover {
  background-color: #222222;
}
.app-button > .material-symbols-outlined {
  font-size: 20px;
  color: #b4b4b4;
}
</style>
