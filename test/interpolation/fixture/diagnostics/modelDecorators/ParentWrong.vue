<template>
  <div>
    <model-button :value="badColor" />
    <model-button :count="badCount" />
    <model-button value="tertiary" />
  </div>
</template>

<script lang="ts">
import Vue from 'vue';
import ModelButton from './ModelButton.vue';

export default Vue.extend({
  components: {
    ModelButton
  },
  computed: {
    badColor(): 'tertiary' {
      return 'tertiary';
    },
    badCount(): string {
      return 'x';
    }
  }
});
</script>
