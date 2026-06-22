<template>
  <div>
    <model-button @></model-button>
    <model-button shade="" />
  </div>
</template>

<script lang="ts">
import Vue from 'vue';
import ModelButton from './ModelButton.vue';

export default Vue.extend({
  components: {
    ModelButton
  }
});
</script>
