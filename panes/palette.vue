<script setup>
import { computed, ref } from "vue";

const props = defineProps({
  title: { type: String, default: "Palette" },
  focused: { type: Boolean, default: false },
  runtimeState: { type: String, default: "live" },
});

const hue = ref(28);
const saved = ref([18, 152, 210]);
const swatch = computed(() => `oklch(0.78 0.12 ${hue.value})`);

function keep() {
  saved.value = [hue.value, ...saved.value].slice(0, 6);
}
</script>

<template>
  <section class="palette">
    <header>
      <p>{{ props.title }}</p>
      <span>{{ props.focused ? "Focused" : "Idle" }} · {{ props.runtimeState }}</span>
    </header>
    <div class="field" :style="{ background: swatch }"></div>
    <label>
      Hue {{ hue }}
      <input v-model.number="hue" type="range" min="0" max="360" />
    </label>
    <button type="button" @click="keep">Save swatch</button>
    <div class="row">
      <button
        v-for="item in saved"
        :key="item"
        type="button"
        class="chip"
        :style="{ background: `oklch(0.78 0.12 ${item})` }"
        @click="hue = item"
      >
        {{ item }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.palette {
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  color: #f4efe6;
  background: #171923;
  font-family: "Avenir Next", "Segoe UI", sans-serif;
}
header { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
p { margin: 0; letter-spacing: 0.16em; text-transform: uppercase; font-size: 11px; color: #b7b4c7; }
span { font-size: 12px; color: #d7d4e4; }
.field { flex: 1; min-height: 80px; border-radius: 18px; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.16); }
label { display: grid; gap: 8px; font-size: 13px; color: #d7d4e4; }
input { width: 100%; accent-color: #f4efe6; }
button { border: 0; border-radius: 12px; padding: 10px 12px; background: #f4efe6; color: #171923; cursor: pointer; }
.row { display: flex; gap: 8px; flex-wrap: wrap; }
.chip { min-width: 52px; color: #171923; font-variant-numeric: tabular-nums; }
</style>
