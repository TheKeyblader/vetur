<template>
  <div>
    <model-button :value="okColor" />
    <model-button :count="okCount" />
    <model-button :shade="okShade" />
    <model-button value="secondary" />
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
    okColor(): 'secondary' {
      return 'secondary';
    },
    okCount(): number {
      return 1;
    },
    okShade(): 'primary' {
      return 'primary';
    }
  }
});
</script>
