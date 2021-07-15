<template>
  <h1>Hiya</h1>
</template>

<script lang="ts">
import { defineComponent, ref } from 'vue';

export default defineComponent({
  setup() {
    const foo: string = 'hi';
    return {};
  },
});
</script>

<style>
h1 {
  color: green;
}
</style>
